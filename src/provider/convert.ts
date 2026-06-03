import vscode from 'vscode';
import { safeStringify } from '../json';
import type {
	DeepSeekContentPart,
	DeepSeekImagePart,
	DeepSeekMessage,
	DeepSeekTool,
	DeepSeekToolCall,
} from '../types';
import { parseFirstReplayMarker } from './replay';

/**
 * Convert VS Code chat messages to DeepSeek format.
 * Injects marker-replayed reasoning_content for assistant messages.
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	isThinkingModel: boolean,
): DeepSeekMessage[] {
	const result: DeepSeekMessage[] = [];

	for (const message of messages) {
		const role = mapRole(message.role);

		let content = '';
		let thinkingContent = '';
		const contentImageParts: DeepSeekImagePart[] = [];
		const toolCalls: DeepSeekToolCall[] = [];
		const toolResults: Array<{ callId: string; content: string }> = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				content += part.value;
			} else if (
				part instanceof vscode.LanguageModelDataPart &&
				part.mimeType.startsWith('image/')
			) {
				// Native image passthrough — convert to OpenAI-compatible image_url content part
				const base64 = uint8ArrayToBase64(part.data);
				contentImageParts.push({
					type: 'image_url',
					image_url: { url: `data:${part.mimeType};base64,${base64}` },
				});
			} else if (isLanguageModelThinkingPart(part)) {
				thinkingContent += normalizeThinkingPartText(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: safeStringify(part.input),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				let toolContent = '';
				for (const item of part.content) {
					if (item instanceof vscode.LanguageModelTextPart) {
						toolContent += item.value;
					}
				}
				toolResults.push({
					callId: part.callId,
					content: toolContent || safeStringify(part.content),
				});
			}
		}

		if (role === 'assistant') {
			if (content || toolCalls.length > 0) {
				const replayMarker = isThinkingModel ? parseFirstReplayMarker(message) : undefined;
				const msg: DeepSeekMessage = {
					role: 'assistant' as const,
					content: content || '',
				};

				if (toolCalls.length > 0) {
					msg.tool_calls = toolCalls;
				}

				if (isThinkingModel) {
					msg.reasoning_content = getReasoningContent(replayMarker, thinkingContent);
				}

				result.push(msg);
			}
		} else {
			appendToolResults(result, toolResults);

			// User message — build content (string or content parts array for native images)
			const contentParts: DeepSeekContentPart[] = [];
			if (content) {
				contentParts.push({ type: 'text', text: content });
			}
			contentParts.push(...contentImageParts);

			if (contentParts.length > 0) {
				result.push({
					role: role as 'user' | 'assistant',
					content:
						contentParts.length === 1 && contentParts[0].type === 'text'
							? contentParts[0].text
							: contentParts,
				});
			}

			continue;
		}

		// Tool result messages follow their associated assistant message
		appendToolResults(result, toolResults);
	}

	return result;
}

function appendToolResults(
	result: DeepSeekMessage[],
	toolResults: ReadonlyArray<{ callId: string; content: string }>,
): void {
	for (const tr of toolResults) {
		result.push({
			role: 'tool',
			content: tr.content,
			tool_call_id: tr.callId,
		});
	}
}

function getReasoningContent(
	replayMarker: ReturnType<typeof parseFirstReplayMarker>,
	thinkingContent: string,
): string {
	if (replayMarker?.valid && replayMarker.reasoningText) {
		return replayMarker.reasoningText;
	}
	return thinkingContent;
}

/** @internal Shared helper, also used by convert-anthropic.ts */
export function isLanguageModelThinkingPart(
	part: unknown,
): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

/** @internal Shared helper, also used by convert-anthropic.ts */
export function normalizeThinkingPartText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}

/** @internal Shared helper, also used by convert-anthropic.ts */
export function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			return 'user';
	}
}

/** @internal Shared helper, also used by convert-anthropic.ts */
export function uint8ArrayToBase64(data: Uint8Array): string {
	return Buffer.from(data).toString('base64');
}

export function normalizeToolInputSchema(inputSchema: unknown): Record<string, unknown> {
	const schema = isRecord(inputSchema) ? { ...inputSchema } : {};
	schema.type = 'object';
	if (!isRecord(schema.properties)) {
		schema.properties = {};
	}
	return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convert VS Code tool definitions to DeepSeek format.
 */
export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): DeepSeekTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const result: DeepSeekTool[] = [];
	for (const tool of tools) {
		if (!tool.name) {
			continue;
		}
		result.push({
			type: 'function' as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: normalizeToolInputSchema(tool.inputSchema),
			},
		});
	}
	return result.length > 0 ? result : undefined;
}

/**
 * Count total characters across all messages to calibrate chars-per-token ratio.
 */
export function countMessageChars(messages: DeepSeekMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		total += msg.content?.length ?? 0;
		total += msg.reasoning_content?.length ?? 0;
		if (msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				total += tc.function?.name?.length ?? 0;
				total += tc.function?.arguments?.length ?? 0;
			}
		}
	}
	return total;
}
