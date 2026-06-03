import vscode from 'vscode';
import { createUserFacingError } from '../client';
import { logger } from '../logger';
import type { DeepSeekToolCall, DeepSeekUsage } from '../types';
import {
	formatRequestLogLine,
	observeCancellationToken,
	type CacheDiagnosticsRun,
	type ReplayMarkerReportTrigger,
} from './debug';
import {
	createReplayMarkerPart,
	hasReplayMarkerMetadata,
	type ReplayMarkerMetadata,
} from './replay';
import type { PreparedChatRequest } from './request';
import { streamPreparedRequest } from './request';

interface ResponseStreamState {
	reasoningChunks: string[];
	reasoningTextLength: number;
	emittedToolCallIds: string[];
	initialResponseNoticeReported: boolean;
	replayMarkerReported: boolean;
}

type PendingPart = { kind: 'content'; text: string } | { kind: 'thinking'; text: string };

interface PartBatcher {
	enqueueContent: (text: string) => void;
	enqueueThinking: (text: string) => void;
	flush: () => void;
}

const COPILOT_USAGE_DATA_PART_MIME = 'usage';

export interface StreamChatCompletionOptions {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	initialResponseNotice?: string;
	getCharsPerToken: () => number;
	setCharsPerToken: (charsPerToken: number) => void;
}

export function streamChatCompletion({
	prepared,
	progress,
	token,
	initialResponseNotice,
	getCharsPerToken,
	setCharsPerToken,
}: StreamChatCompletionOptions): Promise<void> {
	const state: ResponseStreamState = {
		reasoningChunks: [],
		reasoningTextLength: 0,
		emittedToolCallIds: [],
		initialResponseNoticeReported: false,
		replayMarkerReported: false,
	};
	const cancelListener = observeCancellationToken(token, prepared.cacheDiagnostics);
	const batcher = createPartBatcher(progress, token);

	return streamPreparedRequest(
		prepared,
		{
			onContent: (content: string) => {
				reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
				batcher.enqueueContent(content);
			},

			onThinking: (text: string) => {
				reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
				state.reasoningChunks.push(text);
				state.reasoningTextLength += text.length;
				batcher.enqueueThinking(text);
			},

			onToolCall: (toolCall: DeepSeekToolCall) => {
				reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
				handleToolCall(toolCall, state, progress);
			},

			onError: (error: Error) => {
				throw createUserFacingError(error);
			},

			onDone: () => {
				reportReplayMarkerOnce(prepared, progress, state, 'done');
				finalizeReplayDiagnostics(prepared.trailingToolResultIds, state, prepared.cacheDiagnostics);
			},

			onUsage: (usage) => {
				const charsPerToken = updateCharsPerToken(
					prepared.totalRequestChars,
					usage,
					getCharsPerToken(),
				);
				setCharsPerToken(charsPerToken);
				prepared.cacheDiagnostics.onUsage(usage, charsPerToken);
				reportCopilotContextUsage(progress, usage);
			},
		},
		token,
	)
		.then(undefined, (error) => {
			reportSkippedReplayMarkerIfNeeded(
				prepared,
				state,
				token.isCancellationRequested ? 'cancelled' : 'stream-error',
				error,
			);
			throw error;
		})
		.then(() => {
			if (token.isCancellationRequested) {
				reportSkippedReplayMarkerIfNeeded(prepared, state, 'cancelled');
			}
		})
		.finally(() => {
			batcher.flush();
			cancelListener.dispose();
		});
}

function createPartBatcher(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	token: vscode.CancellationToken,
): PartBatcher {
	const pending: PendingPart[] = [];
	let scheduled = false;

	const flush = (): void => {
		scheduled = false;
		if (token.isCancellationRequested || pending.length === 0) {
			pending.length = 0;
			return;
		}
		let i = 0;
		while (i < pending.length) {
			const kind = pending[i].kind;
			let text = '';
			while (i < pending.length && pending[i].kind === kind) {
				text += pending[i].text;
				i += 1;
			}
			if (kind === 'content') {
				progress.report(new vscode.LanguageModelTextPart(text));
			} else {
				// LanguageModelThinkingPart is a proposed API; the project root augmentation provides types.
				progress.report(
					new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart,
				);
			}
		}
		pending.length = 0;
	};

	const schedule = (): void => {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(flush);
	};

	return {
		enqueueContent: (text) => {
			if (!text) return;
			pending.push({ kind: 'content', text });
			schedule();
		},
		enqueueThinking: (text) => {
			if (!text) return;
			pending.push({ kind: 'thinking', text });
			schedule();
		},
		flush,
	};
}

function reportInitialResponseNoticeOnce(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	initialResponseNotice: string | undefined,
): void {
	if (!initialResponseNotice || state.initialResponseNoticeReported) {
		return;
	}
	state.initialResponseNoticeReported = true;
	progress.report(new vscode.LanguageModelTextPart(initialResponseNotice));
}

function reportReplayMarkerOnce(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: ReplayMarkerReportTrigger,
): void {
	if (state.replayMarkerReported) {
		return;
	}
	state.replayMarkerReported = true;
	reportReplayMarker(prepared, progress, state, trigger);
}

function reportSkippedReplayMarkerIfNeeded(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
	reason: 'cancelled' | 'stream-error',
	error?: unknown,
): void {
	if (state.replayMarkerReported) {
		return;
	}
	state.replayMarkerReported = true;
	prepared.cacheDiagnostics.onReplayMarkerReport({
		status: 'skipped',
		reason,
		reasoningTextChars: state.reasoningTextLength || undefined,
		error,
	});
}

function reportReplayMarker(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: ReplayMarkerReportTrigger,
): void {
	const metadata = getReplayMarkerMetadata(prepared, state);
	if (!hasReplayMarkerMetadata(metadata)) {
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'skipped',
			trigger,
			reason: 'no-replay-data',
			reasoningTextChars: state.reasoningTextLength || undefined,
		});
		return;
	}

	try {
		const markerPart = createReplayMarkerPart(metadata);
		progress.report(markerPart);
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'reported',
			trigger,
			markerBytes: markerPart.data.byteLength,
			reasoningTextChars: state.reasoningTextLength || undefined,
		});
	} catch (error) {
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'failed',
			trigger,
			reasoningTextChars: state.reasoningTextLength || undefined,
			error,
		});
		logger.warn(
			formatRequestLogLine(prepared.requestKind, 'Failed to report replay marker'),
			error,
		);
	}
}

function getReplayMarkerMetadata(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
): ReplayMarkerMetadata {
	return {
		...prepared.replayMarkerMetadata,
		reasoningText: state.reasoningChunks.length > 0 ? state.reasoningChunks.join('') : undefined,
	};
}

function handleToolCall(
	toolCall: DeepSeekToolCall,
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	state.emittedToolCallIds.push(toolCall.id);

	try {
		const args = JSON.parse(toolCall.function.arguments);
		progress.report(
			new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
		);
	} catch {
		progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {}));
	}
}

function finalizeReplayDiagnostics(
	trailingToolResultIds: readonly string[],
	state: ResponseStreamState,
	cacheDiagnostics: CacheDiagnosticsRun,
): void {
	cacheDiagnostics.onDone({
		reasoningTextChars: state.reasoningTextLength,
		emittedToolCalls: state.emittedToolCallIds.length,
		trailingToolResults: trailingToolResultIds.length,
	});
}

function updateCharsPerToken(
	totalRequestChars: number,
	usage: DeepSeekUsage,
	charsPerToken: number,
): number {
	if (totalRequestChars > 0 && usage.prompt_tokens > 0) {
		const observedRatio = totalRequestChars / usage.prompt_tokens;
		return charsPerToken * 0.7 + observedRatio * 0.3;
	}
	return charsPerToken;
}

function reportCopilotContextUsage(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	usage: DeepSeekUsage,
): void {
	const data = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
		prompt_tokens_details: {
			cached_tokens: usage.prompt_cache_hit_tokens ?? 0,
		},
	};

	progress.report(
		new vscode.LanguageModelDataPart(
			new TextEncoder().encode(JSON.stringify(data)),
			COPILOT_USAGE_DATA_PART_MIME,
		),
	);
}
