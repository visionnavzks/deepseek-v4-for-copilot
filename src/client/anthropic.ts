import type { CancellationToken } from 'vscode';
import { safeStringify } from '../json';
import { logger } from '../logger';
import type {
	AnthropicRequest,
	AnthropicSSEEvent,
	DeepSeekToolCall,
	StreamCallbacks,
} from '../types';
import { createHttpError, normalizeRequestError } from './error';

/**
 * Lightweight SSE-streaming Anthropic Messages API client.
 * No external dependencies — uses Node's built-in fetch.
 */
export class AnthropicClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
	) {}

	async streamChatCompletion(
		request: AnthropicRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			controller.abort();
		});
		if (cancellationToken?.isCancellationRequested) {
			controller.abort();
		}

		try {
			const response = await fetch(`${this.baseUrl}/v1/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.apiKey,
					'anthropic-version': '2023-06-01',
				},
				body: safeStringify({ ...request, stream: true }),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw await createHttpError(response, this.baseUrl);
			}

			if (!response.body) {
				throw new Error('No response body received');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let currentEventType = '';

			// Track content blocks for tool call accumulation
			const pendingToolCalls = new Map<number, DeepSeekToolCall>();

			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					controller.abort();
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) {
						continue;
					}

					if (trimmed.startsWith('event: ')) {
						currentEventType = trimmed.slice(7);
						continue;
					}

					if (!trimmed.startsWith('data: ')) {
						continue;
					}

					const jsonStr = trimmed.slice(6);
					try {
						const event: AnthropicSSEEvent = JSON.parse(jsonStr);
						this.handleEvent(event, currentEventType, callbacks, pendingToolCalls);
					} catch (e) {
						logger.error('Failed to parse Anthropic SSE chunk:', jsonStr.slice(0, 200), e);
					}
				}
			}

			// Flush any remaining tool calls
			for (const tc of pendingToolCalls.values()) {
				callbacks.onToolCall(tc);
			}
			pendingToolCalls.clear();
			callbacks.onDone();
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalizedError = normalizeRequestError(error);
			logger.error('Anthropic request failed:', getDiagnosticMessage(normalizedError), error);
			callbacks.onError(normalizedError);
		} finally {
			cancelListener?.dispose();
		}
	}

	private handleEvent(
		event: AnthropicSSEEvent,
		eventType: string,
		callbacks: StreamCallbacks,
		pendingToolCalls: Map<number, DeepSeekToolCall>,
	): void {
		switch (event.type) {
			case 'content_block_start': {
				const block = event.content_block as { type: string; id?: string; name?: string };
				if (block.type === 'tool_use' && block.id) {
					pendingToolCalls.set(event.index as number, {
						id: block.id,
						type: 'function',
						function: { name: block.name || '', arguments: '' },
					});
				}
				break;
			}

			case 'content_block_delta': {
				const delta = event.delta as
					| { type: 'text_delta'; text: string }
					| { type: 'thinking_delta'; thinking: string }
					| { type: 'input_json_delta'; partial_json: string };
				if (delta.type === 'text_delta' && delta.text) {
					callbacks.onContent(delta.text);
				} else if (delta.type === 'thinking_delta' && delta.thinking) {
					callbacks.onThinking(delta.thinking);
				} else if (delta.type === 'input_json_delta' && delta.partial_json) {
					const pending = pendingToolCalls.get(event.index as number);
					if (pending) {
						pending.function.arguments += delta.partial_json;
					}
				}
				break;
			}

			case 'content_block_stop': {
				const idx = event.index as number;
				const pending = pendingToolCalls.get(idx);
				if (pending) {
					callbacks.onToolCall(pending);
					pendingToolCalls.delete(idx);
				}
				break;
			}

			case 'message_delta': {
				const usage = event.usage as { output_tokens?: number } | undefined;
				if (usage?.output_tokens && callbacks.onUsage) {
					callbacks.onUsage({
						prompt_tokens: 0,
						completion_tokens: usage.output_tokens,
						total_tokens: usage.output_tokens,
					});
				}
				break;
			}

			case 'message_stop':
				break;
		}
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function getDiagnosticMessage(error: Error): string {
	return 'diagnosticMessage' in error && typeof error.diagnosticMessage === 'string'
		? error.diagnosticMessage
		: error.message;
}
