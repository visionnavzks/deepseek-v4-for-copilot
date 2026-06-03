import vscode from 'vscode';
import { AuthManager } from '../auth';
import { AnthropicClient, DeepSeekClient } from '../client';
import { getApiModelId, getBaseUrlForModel, getMaxTokens } from '../config';
import { MODELS } from '../consts';
import { t } from '../i18n';
import type { AnthropicRequest, DeepSeekRequest, StreamCallbacks } from '../types';
import { convertMessages, countMessageChars } from './convert';
import { convertMessagesAnthropic, convertToolsAnthropic } from './convert-anthropic';
import {
	classifyDeepSeekRequest,
	dumpDeepSeekRequest,
	type CacheDiagnosticsRecorder,
	type CacheDiagnosticsRun,
	type RequestKind,
} from './debug';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import type { ReplayMarkerMetadata } from './replay';
import type { ConversationSegment } from './segment';
import { collectTrailingToolResultIds, prepareRequestTools } from './tools/request';
import { resolveImageMessages } from './vision/index';

export type ChatClient =
	| { kind: 'deepseek'; client: DeepSeekClient; request: DeepSeekRequest }
	| { kind: 'anthropic'; client: AnthropicClient; request: AnthropicRequest };

export interface PreparedChatRequest {
	chatClient: ChatClient;
	isThinkingModel: boolean;
	totalRequestChars: number;
	trailingToolResultIds: string[];
	cacheDiagnostics: CacheDiagnosticsRun;
	requestKind: RequestKind;
	segment: ConversationSegment;
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionMarkerTextChars?: number;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	globalStorageUri: vscode.Uri;
	modelInfo: vscode.LanguageModelChatInformation;
	segment: ConversationSegment;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
	cacheDiagnostics: CacheDiagnosticsRecorder;
	getVisionModel: () => Promise<vscode.LanguageModelChat | undefined>;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
}

export function streamPreparedRequest(
	prepared: PreparedChatRequest,
	callbacks: StreamCallbacks,
	token: vscode.CancellationToken,
): Promise<void> {
	if (prepared.chatClient.kind === 'anthropic') {
		return prepared.chatClient.client.streamChatCompletion(
			prepared.chatClient.request,
			callbacks,
			token,
		);
	}
	return prepared.chatClient.client.streamChatCompletion(
		prepared.chatClient.request,
		callbacks,
		token,
	);
}

export async function prepareChatRequest({
	authManager,
	globalStorageUri,
	modelInfo,
	segment,
	messages,
	options,
	token,
	cacheDiagnostics,
	getVisionModel,
	progress,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKeyForModel(modelInfo.id);
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const modelDef = MODELS.find((m) => m.id === modelInfo.id);
	const baseUrl = getBaseUrlForModel(modelDef);
	const isThinkingModel = modelDef?.capabilities.thinking ?? false;
	const thinkingEffort = getConfiguredThinkingEffort(options as ModelConfigurationOptions);
	const maxTokens = getMaxTokens();

	const [visionResolution, tools] = await Promise.all([
		resolveImageMessages(
			messages,
			token,
			getVisionModel,
			modelDef?.capabilities.imageInput ?? false,
			{
				onVisionStarted: () => {
					progress.report(new vscode.LanguageModelTextPart(t('vision.inProgress')));
				},
			},
		),
		Promise.resolve(prepareRequestTools(modelDef?.capabilities.toolCalling, options)),
	]);
	const resolvedMessages = visionResolution.messages;

	const isAnthropicFamily = modelDef?.family === 'opencode-go-anthropic';

	let chatClient: ChatClient;
	let deepseekMessages: ReturnType<typeof convertMessages>;
	let totalRequestChars: number;

	if (isAnthropicFamily) {
		// ---- Anthropic Messages protocol path ----
		const { system, anthropicMessages: anthMessages } = convertMessagesAnthropic(resolvedMessages);
		const anthTools = convertToolsAnthropic(options.tools);

		const thinkingBudget = thinkingEffort === 'max' ? 32768 : thinkingEffort === 'high' ? 16384 : 0;

		const request: AnthropicRequest = {
			model: getApiModelId(modelInfo.id),
			max_tokens: maxTokens || 16384,
			messages: anthMessages,
			stream: true,
			...(system ? { system } : {}),
			...(isThinkingModel && thinkingEffort !== 'none'
				? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } }
				: isThinkingModel
					? { thinking: { type: 'disabled' } }
					: {}),
			...(anthTools && anthTools.length > 0
				? { tools: anthTools, tool_choice: { type: 'auto' } }
				: {}),
		};

		const client = new AnthropicClient(baseUrl, apiKey);
		chatClient = { kind: 'anthropic', client, request };
		// Approximate char count from Anthropic messages for calibration
		totalRequestChars = anthMessages.reduce((acc, m) => {
			if (typeof m.content === 'string') return acc + m.content.length;
			return acc + m.content.reduce((a, b) => a + ('text' in b ? b.text.length : 0), 0);
		}, 0);
		deepseekMessages = [];
	} else {
		// ---- OpenAI / DeepSeek compatible path ----
		const client = new DeepSeekClient(baseUrl, apiKey);
		const deepMsgs = convertMessages(resolvedMessages, isThinkingModel);

		const request: DeepSeekRequest = {
			model: getApiModelId(modelInfo.id),
			messages: deepMsgs,
			stream: true,
			tools,
			tool_choice: tools && tools.length > 0 ? ('auto' as const) : undefined,
			...(modelDef?.family === 'minimaxi'
				? { max_completion_tokens: maxTokens }
				: { max_tokens: maxTokens }),
			...(isThinkingModel
				? {
						...(modelDef?.family === 'deepseek'
							? {
									thinking: {
										type: thinkingEffort === 'none' ? ('disabled' as const) : ('enabled' as const),
									},
								}
							: {}),
						...(modelDef?.family === 'minimaxi'
							? {
									thinking: {
										type: thinkingEffort === 'none' ? ('disabled' as const) : ('adaptive' as const),
									},
									reasoning_split: true,
								}
							: {}),
						...(thinkingEffort === 'none'
							? {}
							: {
									reasoning_effort:
										modelDef?.family === 'deepseek'
											? thinkingEffort
											: modelDef?.family === 'minimaxi'
												? undefined
												: // Non-DeepSeek providers (Xiaomi, OpenCode Go) may not support 'max'.
													thinkingEffort === 'max'
													? 'high'
													: thinkingEffort,
								}),
					}
				: {}),
		};

		chatClient = { kind: 'deepseek', client, request };
		deepseekMessages = deepMsgs;
		totalRequestChars = countMessageChars(deepseekMessages);
	}

	// Debug/diagnostics expect a DeepSeekRequest — synthesize one for Anthropic models.
	const debugRequest: DeepSeekRequest =
		chatClient.kind === 'deepseek'
			? chatClient.request
			: { model: chatClient.request.model, messages: [], stream: true };

	const requestKind = classifyDeepSeekRequest({
		request: debugRequest,
		inputMessages: messages,
	});
	dumpDeepSeekRequest(debugRequest, {
		globalStorageUri,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		requestOptions: options,
		visionModelId: visionResolution.visionModelId,
		visionStats: visionResolution.stats,
	});

	const diagnosticsRun = cacheDiagnostics.beginRequest({
		request: debugRequest,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		visionModelId: visionResolution.visionModelId,
		visionStats: visionResolution.stats,
	});

	return {
		chatClient,
		isThinkingModel,
		totalRequestChars,
		trailingToolResultIds: collectTrailingToolResultIds(deepseekMessages),
		cacheDiagnostics: diagnosticsRun,
		requestKind,
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
	};
}
