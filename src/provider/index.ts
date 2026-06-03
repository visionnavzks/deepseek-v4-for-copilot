import vscode from 'vscode';
import { AuthManager } from '../auth';
import { getStabilizeToolListEnabled } from '../config';
import { MODELS, resolveProviderId, type ProviderId } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import {
	classifyProviderRequest,
	createCacheDiagnosticsRecorder,
	dumpProviderInput,
} from './debug';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { resolveConversationSegment } from './segment';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { processToolFlow } from './tools/flow';

/**
 * DeepSeek Chat Provider — implements vscode.LanguageModelChatProvider so
 * DeepSeek V4 models appear directly in the Copilot Chat model picker.
 */
export class DeepSeekChatProvider implements vscode.LanguageModelChatProvider {
	private readonly authManager: AuthManager;
	private readonly globalStorageUri: vscode.Uri;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private readonly cacheDiagnostics = createCacheDiagnosticsRecorder();

	/**
	 * Adaptive chars-per-token ratio, calibrated from actual usage data.
	 * Updated via exponential moving average each time the API reports real token counts.
	 */
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);
		this.globalStorageUri = context.globalStorageUri;

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration('deepseek-copilot.apiKey') ||
					e.affectsConfiguration('deepseek-copilot.apiKeys')
				) {
					this.onDidChangeLanguageModelChatInformationEmitter.fire();
				}
			}),
			// Multi-window: SecretStorage changes don't fire onDidChangeConfiguration.
			// When another window sets/clears an API key, refresh this window's
			// model picker so the warning state stays in sync.
			context.secrets.onDidChange((e) => {
				if (e.key === 'deepseek-copilot.apiKey' || e.key.startsWith('deepseek-copilot.apiKey.')) {
					this.onDidChangeLanguageModelChatInformationEmitter.fire();
				}
			}),
		);
	}

	// ---- Public commands ----

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	async configureApiKeyForProvider(providerId: ProviderId): Promise<void> {
		const saved = await this.authManager.promptForProviderApiKey(providerId);
		if (saved) {
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	async clearApiKeyForProvider(providerId: ProviderId): Promise<void> {
		await this.authManager.deleteApiKeyForProvider(providerId);
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasAnyApiKey();
	}

	/** Force Copilot Chat to re-query model information (including configurationSchema). */
	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();

		// Force the host to re-pull `provideLanguageModelChatInformation` synchronously
		// before the extension unloads. With `isActive = false` we now return [],
		// which makes Copilot Chat drop our models from the picker immediately
		// instead of leaving stale entries behind after deactivate. The returned
		// model list itself is unused — we only call this for its side effect.
		try {
			await vscode.lm.selectChatModels({ vendor: 'deepseek' });
		} catch (error) {
			logger.warn('Failed to refresh MultiModel models during deactivate', error);
		}
	}

	// ---- LanguageModelChatProvider ----

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		return Promise.all(
			MODELS.map(async (model) => {
				const hasKey = await this.authManager.hasApiKeyForProvider(resolveProviderId(model.family));
				return toChatInfo(model, hasKey);
			}),
		);
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const segment = resolveConversationSegment(messages);
		const requestKind = classifyProviderRequest({
			messages,
			tools: options.tools,
		});

		dumpProviderInput({
			globalStorageUri: this.globalStorageUri,
			segment,
			modelInfo,
			messages,
			requestOptions: options,
			requestKind,
		});

		const toolFlow = processToolFlow({
			stabilizeToolList: getStabilizeToolListEnabled(),
			messages,
			tools: options.tools,
			progress,
			requestKind,
		});
		if (toolFlow.preflightHandled) {
			return;
		}

		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			globalStorageUri: this.globalStorageUri,
			modelInfo,
			segment,
			messages: toolFlow.messages,
			options,
			cacheDiagnostics: this.cacheDiagnostics,
		});

		return streamChatCompletion({
			prepared,
			progress,
			token,
			initialResponseNotice: toolFlow.initialResponseNotice,
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (charsPerToken) => {
				this.charsPerToken = charsPerToken;
			},
		});
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}
}
