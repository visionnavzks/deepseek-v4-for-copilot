import vscode from 'vscode';
import { safeStringify } from '../json';
import type {
    AnthropicContentBlock,
    AnthropicMessage,
    AnthropicTool,
    DeepSeekToolCall,
} from '../types';
import {
    isLanguageModelThinkingPart,
    mapRole,
    normalizeThinkingPartText,
    normalizeToolInputSchema,
    uint8ArrayToBase64,
} from './convert';

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
		input_schema: normalizeToolInputSchema(tool.inputSchema),
	}));
}
