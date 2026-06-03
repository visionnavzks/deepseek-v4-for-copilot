import vscode from 'vscode';
import { PROVIDER_IDS } from '../consts';
import { logger } from '../logger';
import { DeepSeekChatProvider } from '../provider';

export async function registerProvider(
	context: vscode.ExtensionContext,
): Promise<DeepSeekChatProvider> {
	const provider = new DeepSeekChatProvider(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('deepseek-copilot.clearApiKey', () => provider.clearApiKey()),

		// Per-provider key commands
		...PROVIDER_IDS.map((pid) =>
			vscode.commands.registerCommand(`deepseek-copilot.setApiKey.${pid}`, () =>
				provider.configureApiKeyForProvider(pid),
			),
		),
		...PROVIDER_IDS.map((pid) =>
			vscode.commands.registerCommand(`deepseek-copilot.clearApiKey.${pid}`, () =>
				provider.clearApiKeyForProvider(pid),
			),
		),

		vscode.lm.registerLanguageModelChatProvider('deepseek', provider),
	);

	// Copilot Chat can serve cached model info without configurationSchema.
	// Activate it first so this refresh reaches a live listener and re-queries the provider.
	await activateCopilotChat();
	provider.refreshModelPicker();

	return provider;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
