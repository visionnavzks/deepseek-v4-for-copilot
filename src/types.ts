/**
 * Shared types for the DeepSeek Copilot extension.
 */

// ---- API request/response types ----

export interface DeepSeekMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | DeepSeekContentPart[];
	tool_call_id?: string;
	tool_calls?: DeepSeekToolCall[];
	reasoning_content?: string;
}

/** OpenAI-compatible content part for text. */
export interface DeepSeekTextPart {
	type: 'text';
	text: string;
}

/** OpenAI-compatible content part for image (base64 data URL). */
export interface DeepSeekImagePart {
	type: 'image_url';
	image_url: { url: string };
}

export type DeepSeekContentPart = DeepSeekTextPart | DeepSeekImagePart;

/**
 * Extract the concatenated text from a DeepSeekMessage.content field.
 * Handles both `string` (text-only) and `ContentPart[]` (multimodal) formats.
 */
export function extractMessageText(content: string | DeepSeekContentPart[]): string {
	if (typeof content === 'string') {
		return content;
	}
	return content
		.filter((p): p is DeepSeekTextPart => p.type === 'text')
		.map((p) => p.text)
		.join('');
}

export interface DeepSeekToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface DeepSeekTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface DeepSeekUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
}

export interface DeepSeekRequest {
	model: string;
	messages: DeepSeekMessage[];
	stream: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	/** MiniMax-specific: use max_completion_tokens instead of max_tokens. */
	max_completion_tokens?: number;
	tools?: DeepSeekTool[];
	tool_choice?: 'none' | 'auto' | 'required';
	/** Thinking control. DeepSeek: { type: 'enabled'|'disabled' }; MiniMax: { type: 'adaptive'|'disabled' }. */
	thinking?: { type: 'enabled' | 'disabled' } | { type: 'adaptive' | 'disabled' };
	/** MiniMax: split thinking into reasoning_content field. */
	reasoning_split?: boolean;
	reasoning_effort?: 'high' | 'max';
	stream_options?: {
		include_usage: boolean;
	};
}

export interface DeepSeekStreamChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			reasoning_content?: string;
			reasoning_text?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason: string | null;
	}>;
	usage?: DeepSeekUsage;
}

// ---- Stream callbacks ----

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: DeepSeekToolCall) => void;
	onError: (error: Error) => void;
	onDone: () => void;
	onUsage?: (usage: DeepSeekUsage) => void;
}

// ---- Model definitions ----

export interface ModelDefinition {
	id: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: {
		toolCalling: boolean | number;
		imageInput: boolean;
		thinking: boolean;
	};
	requiresThinkingParam: boolean;
	/** Model-level base URL override. When set, bypasses the global baseUrl setting. */
	baseUrl?: string;
	/**
	 * Whether the API returns `reasoning_content` (DeepSeek native) vs `reasoning_text`
	 * (OpenAI-compatible / Go). Controls which SSE field the client parses.
	 */
	nativeReasoningContent?: boolean;
}

// ---- Anthropic Messages protocol types ----

export interface AnthropicRequest {
	model: string;
	max_tokens: number;
	messages: AnthropicMessage[];
	system?: string;
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'disabled' };
	tools?: AnthropicTool[];
	tool_choice?:
		| { type: 'auto' }
		| { type: 'none' }
		| { type: 'any' }
		| { type: 'tool'; name: string };
}

export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
	| { type: 'text'; text: string }
	| { type: 'thinking'; thinking: string; signature?: string }
	| { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
	| { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] }
	| { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface AnthropicTool {
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
}

// ---- Anthropic SSE event types ----

export interface AnthropicSSEEvent {
	type: string;
	[key: string]: unknown;
}

export interface AnthropicMessageStartEvent extends AnthropicSSEEvent {
	type: 'message_start';
	message: {
		id: string;
		type: 'message';
		role: 'assistant';
		content: [];
		model: string;
		stop_reason: null;
		usage: { input_tokens: number; output_tokens: number };
	};
}

export interface AnthropicContentBlockStartEvent extends AnthropicSSEEvent {
	type: 'content_block_start';
	index: number;
	content_block: { type: string; text?: string; name?: string; id?: string };
}

export interface AnthropicContentBlockDeltaEvent extends AnthropicSSEEvent {
	type: 'content_block_delta';
	index: number;
	delta:
		| { type: 'text_delta'; text: string }
		| { type: 'thinking_delta'; thinking: string }
		| { type: 'input_json_delta'; partial_json: string };
}

export interface AnthropicContentBlockStopEvent extends AnthropicSSEEvent {
	type: 'content_block_stop';
	index: number;
}

export interface AnthropicMessageDeltaEvent extends AnthropicSSEEvent {
	type: 'message_delta';
	delta: { stop_reason: string | null; stop_sequence: null };
	usage: { output_tokens: number };
}

export interface AnthropicMessageStopEvent extends AnthropicSSEEvent {
	type: 'message_stop';
}
