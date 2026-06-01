import { DEEPSEEK_TOOLS_LIMIT } from './provider/tools/consts';
import type { ModelDefinition } from './types';

/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'deepseek-copilot';

export const EXTERNAL_URLS = {
	deepseek: {
		apiKeys: 'https://platform.deepseek.com/api_keys',
		usage: 'https://platform.deepseek.com/usage',
		status: 'https://status.deepseek.com',
	},
	minimaxi: {
		apiKeys: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
		usage: 'https://platform.minimaxi.com/user-center/payment/balance',
	},
} as const;

/** URI path handled by this extension to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path handled by this extension to open API key configuration. */
export const CONFIGURE_API_KEY_URI_PATH = '/setApiKey';

// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

// ---- Provider registry ----

/** Unique identifier for each API provider (one key per provider). */
export type ProviderId = 'deepseek' | 'opencode-go' | 'xiaomi-mimo' | 'minimaxi';

/** All supported provider IDs. */
export const PROVIDER_IDS: readonly ProviderId[] = ['deepseek', 'opencode-go', 'xiaomi-mimo', 'minimaxi'];

/** Maps model family → provider ID. */
const FAMILY_TO_PROVIDER: Record<string, ProviderId> = {
	deepseek: 'deepseek',
	'opencode-go': 'opencode-go',
	'opencode-go-anthropic': 'opencode-go',
	'xiaomi-mimo': 'xiaomi-mimo',
	minimaxi: 'minimaxi',
};

/** Resolve a model family to its provider ID. Falls back to 'deepseek' for unknown families. */
export function resolveProviderId(family: string): ProviderId {
	return FAMILY_TO_PROVIDER[family] ?? 'deepseek';
}

// ---- Secret keys ----

/** Legacy SecretStorage key for the single API key (pre-migration). */
export const API_KEY_SECRET = 'deepseek-copilot.apiKey';

/** SecretStorage key pattern for per-provider API keys. */
export const PROVIDER_KEY_SECRET_PREFIX = 'deepseek-copilot.apiKey.';

/** Build the SecretStorage key for a specific provider. */
export function providerKeySecret(providerId: ProviderId): string {
	return `${PROVIDER_KEY_SECRET_PREFIX}${providerId}`;
}

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'deepseek-copilot.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'Vizards.deepseek-v4-for-copilot#deepseekGettingStarted';

// ---- Model registry ----

/** OpenCode Go base URL for OpenAI-compatible models (DeepSeekClient appends /chat/completions). */
const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
/** OpenCode Go base URL for Anthropic-protocol models (AnthropicClient appends /v1/messages). */
const OPENCODE_GO_ANTHROPIC_BASE_URL = 'https://opencode.ai/zen/go';
const XIAOMI_MIMO_BASE_URL = 'https://api.xiaomimimo.com';
const MINIMAX_BASE_URL = 'https://api.minimaxi.com/v1';

/** Available DeepSeek models exposed through the language model provider. */
export const MODELS: ModelDefinition[] = [
	{
		id: 'deepseek-v4-flash',
		name: 'DeepSeek V4 Flash',
		family: 'deepseek',
		version: 'v4',
		detail: 'Fast, general-purpose model',
		maxInputTokens: 1000000,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		nativeReasoningContent: true,
	},
	{
		id: 'deepseek-v4-pro',
		name: 'DeepSeek V4 Pro',
		family: 'deepseek',
		version: 'v4',
		detail: 'Most capable reasoning model',
		maxInputTokens: 1000000,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		nativeReasoningContent: true,
	},
	// ---- OpenCode Go models ----
	{
		id: 'opencode-go-deepseek-v4-flash',
		name: 'DeepSeek V4 Flash (Go)',
		family: 'opencode-go',
		version: 'v4',
		detail: 'Fast, general-purpose model via OpenCode Go',
		maxInputTokens: 1000000,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	{
		id: 'opencode-go-deepseek-v4-pro',
		name: 'DeepSeek V4 Pro (Go)',
		family: 'opencode-go',
		version: 'v4',
		detail: 'Most capable reasoning model via OpenCode Go',
		maxInputTokens: 1000000,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	{
		id: 'opencode-go-mimo-v2.5',
		name: 'MiMo V2.5 (Go)',
		family: 'opencode-go',
		version: 'v2.5',
		detail: 'Balanced reasoning and speed via OpenCode Go',
		maxInputTokens: 1000000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	{
		id: 'opencode-go-mimo-v2.5-pro',
		name: 'MiMo V2.5 Pro (Go)',
		family: 'opencode-go',
		version: 'v2.5',
		detail: 'Enhanced MiMo reasoning via OpenCode Go',
		maxInputTokens: 1000000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	{
		id: 'opencode-go-glm-5.1',
		name: 'GLM-5.1 (Go)',
		family: 'opencode-go',
		version: '5.1',
		detail: 'Zhipu GLM coding model via OpenCode Go',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	{
		id: 'opencode-go-glm-5',
		name: 'GLM-5 (Go)',
		family: 'opencode-go',
		version: '5',
		detail: 'Zhipu GLM general model via OpenCode Go',
		maxInputTokens: 200000,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	{
		id: 'opencode-go-kimi-k2.5',
		name: 'Kimi K2.5 (Go)',
		family: 'opencode-go',
		version: '2.5',
		detail: 'Moonshot Kimi coding model via OpenCode Go',
		maxInputTokens: 256000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	{
		id: 'opencode-go-kimi-k2.6',
		name: 'Kimi K2.6 (Go)',
		family: 'opencode-go',
		version: '2.6',
		detail: 'Moonshot Kimi latest model via OpenCode Go',
		maxInputTokens: 256000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_BASE_URL,
	},
	// ---- OpenCode Go Anthropic-protocol models ----
	{
		id: 'opencode-go-minimax-m2.7',
		name: 'MiniMax M2.7 (Go)',
		family: 'opencode-go-anthropic',
		version: '2.7',
		detail: 'MiniMax M2.7 via OpenCode Go',
		maxInputTokens: 204800,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_ANTHROPIC_BASE_URL,
	},
	{
		id: 'opencode-go-minimax-m2.5',
		name: 'MiniMax M2.5 (Go)',
		family: 'opencode-go-anthropic',
		version: '2.5',
		detail: 'MiniMax M2.5 via OpenCode Go',
		maxInputTokens: 204800,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_ANTHROPIC_BASE_URL,
	},
	{
		id: 'opencode-go-qwen3.7-max',
		name: 'Qwen3.7 Max (Go)',
		family: 'opencode-go-anthropic',
		version: '3.7',
		detail: 'Qwen3.7 Max via OpenCode Go',
		maxInputTokens: 1000000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_ANTHROPIC_BASE_URL,
	},
	{
		id: 'opencode-go-qwen3.6-plus',
		name: 'Qwen3.6 Plus (Go)',
		family: 'opencode-go-anthropic',
		version: '3.6',
		detail: 'Qwen3.6 Plus via OpenCode Go',
		maxInputTokens: 1000000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: OPENCODE_GO_ANTHROPIC_BASE_URL,
	},
	// ---- MiniMax models (OpenAI-compatible) ----
	{
		id: 'minimaxi-m3',
		name: 'MiniMax-M3',
		family: 'minimaxi',
		version: 'm3',
		detail: 'MiniMax-M3 — frontier coding & agentic model',
		maxInputTokens: 1000000,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: 128,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: MINIMAX_BASE_URL,
		nativeReasoningContent: true,
	},
	{
		id: 'minimaxi-m2.7',
		name: 'MiniMax-M2.7',
		family: 'minimaxi',
		version: 'm2.7',
		detail: 'MiniMax-M2.7 — balanced reasoning model',
		maxInputTokens: 1000000,
		maxOutputTokens: 65536,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: MINIMAX_BASE_URL,
		nativeReasoningContent: true,
	},
	{
		id: 'minimaxi-m2.7-highspeed',
		name: 'MiniMax-M2.7 High-Speed',
		family: 'minimaxi',
		version: 'm2.7',
		detail: 'MiniMax-M2.7 High-Speed — faster responses',
		maxInputTokens: 1000000,
		maxOutputTokens: 65536,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: MINIMAX_BASE_URL,
		nativeReasoningContent: true,
	},
	// ---- Xiaomi MiMo models (OpenAI-compatible) ----
	{
		id: 'xiaomi-mimo-v2.5',
		name: 'MiMo V2.5',
		family: 'xiaomi-mimo',
		version: 'v2.5',
		detail: 'Xiaomi MiMo V2.5 — multimodal reasoning',
		maxInputTokens: 1000000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: XIAOMI_MIMO_BASE_URL,
		nativeReasoningContent: true,
	},
	{
		id: 'xiaomi-mimo-v2.5-pro',
		name: 'MiMo V2.5 Pro',
		family: 'xiaomi-mimo',
		version: 'v2.5',
		detail: 'Xiaomi MiMo V2.5 Pro — agentic reasoning',
		maxInputTokens: 1000000,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: 128,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
		baseUrl: XIAOMI_MIMO_BASE_URL,
		nativeReasoningContent: true,
	},
];
