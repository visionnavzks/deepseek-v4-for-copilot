import vscode from 'vscode';
import { safeStringify } from '../json';
import type {
    AnthropicContentBlock,
    AnthropicMessage,
    AnthropicTool,
    DeepSeekContentPart,
    DeepSeekImagePart,
    DeepSeekMessage,
    DeepSeekTool,
    DeepSeekToolCall
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
			} else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
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
			// User message — build content (string or content parts array for native images)
			const contentParts: DeepSeekContentPart[] = [];
			if (content) {
				contentParts.push({ type: 'text', text: content });
			}
			contentParts.push(...contentImageParts);

			result.push({
				role: role as 'user' | 'assistant',
				content: contentParts.length === 1 && contentParts[0].type === 'text'
					? contentParts[0].text
					: contentParts,
			});
		}

		// Tool result messages follow their associated assistant message
		for (const tr of toolResults) {
			result.push({
				role: 'tool',
				content: tr.content,
				tool_call_id: tr.callId,
			});
		}
	}

	return result;
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

function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

function normalizeThinkingPartText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			return 'user';
	}
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
				parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
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

// ---- Anthropic Messages protocol conversion ----

/**
 * Convert VS Code chat messages to Anthropic format.
 * System messages are extracted to a separate return value.
 */
export function convertMessagesAnthropic(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): { system?: string; anthropicMessages: AnthropicMessage[] } {
	const anthropicMessages: AnthropicMessage[] = [];
	let system: string | undefined;

	for (const message of messages) {
		const role = mapRole(message.role);

		let textContent = '';
		const contentBlocks: AnthropicContentBlock[] = [];
		const toolCalls: DeepSeekToolCall[] = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textContent += part.value;
			} else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
				// Native image passthrough — convert to Anthropic image content block
				const base64 = uint8ArrayToBase64(part.data);
				contentBlocks.push({
					type: 'image',
					source: { type: 'base64', media_type: part.mimeType, data: base64 },
				});
			} else if (isLanguageModelThinkingPart(part)) {
				const text = normalizeThinkingPartText(part.value);
				contentBlocks.push({ type: 'thinking', thinking: text });
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
				contentBlocks.push({
					type: 'tool_result',
					tool_use_id: part.callId,
					content: toolContent || safeStringify(part.content),
				});
			}
		}

		if (role === 'user' && !textContent && contentBlocks.length === 0) {
			continue;
		}

		if (role === 'assistant') {
			if (textContent || toolCalls.length > 0) {
				const blocks: AnthropicContentBlock[] = [];
				if (textContent) {
					blocks.push({ type: 'text', text: textContent });
				}
				for (const tc of toolCalls) {
					blocks.push({
						type: 'tool_use',
						id: tc.id,
						name: tc.function.name,
						input: JSON.parse(tc.function.arguments || '{}'),
					});
				}
				anthropicMessages.push({ role: 'assistant', content: blocks });
			}
		} else {
			// User message — combine text, images, and tool results into content blocks
			const hasImages = contentBlocks.some((b) => b.type === 'image');

			if (hasImages && textContent) {
				// Prepend text block before image blocks for multimodal messages
				contentBlocks.unshift({ type: 'text', text: textContent });
				anthropicMessages.push({ role: 'user', content: contentBlocks });
			} else if (contentBlocks.length > 0) {
				// Tool results or images without text
				anthropicMessages.push({ role: 'user', content: contentBlocks });
			} else if (textContent) {
				anthropicMessages.push({ role: 'user', content: textContent });
			}
		}
	}

	// Extract system from first user message if present
	if (anthropicMessages.length > 0 && anthropicMessages[0].role === 'user') {
		const first = anthropicMessages[0];
		if (typeof first.content === 'string') {
			system = first.content;
			anthropicMessages.shift();
		}
	}

	return { system, anthropicMessages };
}

/**
 * Convert VS Code tool definitions to Anthropic format.
 */
export function convertToolsAnthropic(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): AnthropicTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema as Record<string, unknown> | undefined,
	}));
}

/**
 * Convert a Uint8Array to a base64 string.
 * Uses Node.js Buffer for efficiency.
 */
function uint8ArrayToBase64(data: Uint8Array): string {
	return Buffer.from(data).toString('base64');
}
