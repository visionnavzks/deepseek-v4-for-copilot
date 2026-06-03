import vscode from 'vscode';
import {
	API_KEY_SECRET,
	MODELS,
	providerKeySecret,
	resolveProviderId,
	type ProviderId,
} from './consts';
import { t } from './i18n';

/**
 * Manages API keys per provider via VS Code SecretStorage (secure) with
 * fallback to extension settings (less secure, for CI/automation).
 *
 * Key resolution order:
 *   1. SecretStorage `multimodel-copilot.apiKey.<providerId>` (per-provider key)
 *   2. SecretStorage `multimodel-copilot.apiKey` (legacy single key — DeepSeek only)
 *   3. Settings `multimodel-copilot.apiKeys.<providerId>` (per-provider setting)
 *   4. Settings `multimodel-copilot.apiKey` (legacy single setting — DeepSeek only)
 */
export class AuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	// ---- Per-provider key access ----

	/**
	 * Get API key for a specific provider.
	 * Falls back to the legacy single key only for the 'deepseek' provider
	 * (where the legacy key was originally stored).
	 */
	async getApiKeyForProvider(providerId: ProviderId): Promise<string | undefined> {
		// 1. Per-provider SecretStorage
		const providerSecret = await this.secretStorage.get(providerKeySecret(providerId));
		if (providerSecret) {
			return providerSecret;
		}

		// 2. Legacy single SecretStorage (backward compat — DeepSeek only)
		if (providerId === 'deepseek') {
			const legacySecret = await this.secretStorage.get(API_KEY_SECRET);
			if (legacySecret) {
				return legacySecret;
			}
		}

		// 3. Per-provider settings
		const config = vscode.workspace.getConfiguration('multimodel-copilot');
		const providerSettings = config.get<Record<string, string>>('apiKeys');
		const providerSetting = providerSettings?.[providerId]?.trim();
		if (providerSetting) {
			return providerSetting;
		}

		// 4. Legacy single setting (DeepSeek only)
		if (providerId === 'deepseek') {
			const legacySetting = config.get<string>('apiKey');
			if (legacySetting?.trim()) {
				return legacySetting.trim();
			}
		}

		return undefined;
	}

	/**
	 * Get API key for a model by its ID. Resolves the model's family to a provider.
	 */
	async getApiKeyForModel(modelId: string): Promise<string | undefined> {
		const modelDef = MODELS.find((m) => m.id === modelId);
		const providerId = resolveProviderId(modelDef?.family ?? 'deepseek');
		return this.getApiKeyForProvider(providerId);
	}

	/**
	 * Get API key for the legacy (DeepSeek) provider.
	 * Kept for backward compatibility — prefer getApiKeyForProvider / getApiKeyForModel.
	 */
	async getApiKey(): Promise<string | undefined> {
		return this.getApiKeyForProvider('deepseek');
	}

	// ---- Per-provider key mutation ----

	/** Store API key for a specific provider in SecretStorage. */
	async setApiKeyForProvider(providerId: ProviderId, apiKey: string): Promise<void> {
		await this.secretStorage.store(providerKeySecret(providerId), apiKey.trim());
	}

	/** Delete API key for a specific provider from SecretStorage. */
	async deleteApiKeyForProvider(providerId: ProviderId): Promise<void> {
		await this.secretStorage.delete(providerKeySecret(providerId));
	}

	/** Check if a specific provider has an API key configured. */
	async hasApiKeyForProvider(providerId: ProviderId): Promise<boolean> {
		const key = await this.getApiKeyForProvider(providerId);
		return key !== undefined && key.length > 0;
	}

	/**
	 * Check if any provider has an API key configured.
	 * Used by the model picker to decide whether to show warning icons.
	 */
	async hasAnyApiKey(): Promise<boolean> {
		for (const pid of ['deepseek', 'opencode-go', 'xiaomi-mimo', 'minimaxi'] as ProviderId[]) {
			if (await this.hasApiKeyForProvider(pid)) {
				return true;
			}
		}
		return false;
	}

	// ---- Convenience wrappers ----

	/** Store legacy (DeepSeek) API key. */
	async setApiKey(apiKey: string): Promise<void> {
		return this.setApiKeyForProvider('deepseek', apiKey);
	}

	/** Delete legacy (DeepSeek) API key. */
	async deleteApiKey(): Promise<void> {
		return this.deleteApiKeyForProvider('deepseek');
	}

	/** Check if legacy (DeepSeek) API key exists. */
	async hasApiKey(): Promise<boolean> {
		return this.hasApiKeyForProvider('deepseek');
	}

	// ---- Prompts ----

	/**
	 * Prompt user to enter API key for a specific provider.
	 * Shows provider-specific messaging.
	 */
	async promptForProviderApiKey(providerId: string): Promise<boolean> {
		return this.promptForApiKey(providerId as ProviderId);
	}

	/**
	 * Prompt user to enter API key for a specific provider.
	 * Shows provider-specific messaging.
	 */
	async promptForApiKey(providerId?: ProviderId): Promise<boolean> {
		const promptKey = providerId ? `auth.prompt.${providerId}` : 'auth.prompt';
		const placeholderKey = providerId ? `auth.placeholder.${providerId}` : 'auth.placeholder';

		// Fall back to generic prompt if provider-specific one doesn't exist
		const promptText = t(promptKey);
		const prompt = promptText !== promptKey ? promptText : t('auth.prompt');
		const placeholderText = t(placeholderKey);
		const placeholder =
			placeholderText !== placeholderKey ? placeholderText : t('auth.placeholder');

		const apiKey = await vscode.window.showInputBox({
			prompt,
			placeHolder: placeholder,
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return t('auth.emptyValidation');
				}
				return undefined;
			},
		});

		if (apiKey) {
			if (providerId) {
				await this.setApiKeyForProvider(providerId, apiKey);
			} else {
				await this.setApiKey(apiKey);
			}
			vscode.window.showInformationMessage(t('auth.saved'));
			return true;
		}

		return false;
	}
}
