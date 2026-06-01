import type { CancellationToken } from 'vscode';

/**
 * Shared streaming infrastructure for SSE-based API clients.
 *
 * Extracts common patterns used by both DeepSeek (OpenAI-compatible) and
 * Anthropic protocol clients: AbortController setup, token cancellation
 * plumbing, and error helpers.
 */

export interface StreamRequestInit {
	url: string;
	headers: Record<string, string>;
	body: string;
}

export interface StreamContext {
	controller: AbortController;
	cancelListener: { dispose(): void } | undefined;
}

/**
 * Create an AbortController wired to a VS Code CancellationToken.
 * If the token is already cancelled, the controller starts aborted.
 *
 * Returns the controller and a disposable listener; caller *must* call
 * `listener.dispose()` in a `finally` block.
 */
export function createStreamContext(
	cancellationToken?: CancellationToken,
): StreamContext {
	const controller = new AbortController();
	const cancelListener = cancellationToken?.onCancellationRequested(() => {
		controller.abort();
	});
	if (cancellationToken?.isCancellationRequested) {
		controller.abort();
	}
	return { controller, cancelListener };
}

/**
 * Check whether an error is a Fetch/AbortController AbortError.
 */
export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

/**
 * Extract the `diagnosticMessage` field from a DeepSeekRequestError,
 * falling back to the plain Error `message`.
 */
export function getDiagnosticMessage(error: Error): string {
	return 'diagnosticMessage' in error && typeof (error as Record<string, unknown>).diagnosticMessage === 'string'
		? (error as Record<string, string>).diagnosticMessage
		: error.message;
}

/**
 * Perform the initial fetch call for a streaming chat request.
 * Shared by both DeepSeek and Anthropic protocol clients.
 */
export async function streamFetch(
	init: StreamRequestInit,
	context: StreamContext,
): Promise<Response> {
	return fetch(init.url, {
		method: 'POST',
		headers: init.headers,
		body: init.body,
		signal: context.controller.signal,
	});
}
