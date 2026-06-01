import type { ProviderId } from '../consts';

export interface ErrorActionUrls {
	configureApiKey?: string;
	showLogs?: string;
}

export interface ErrorActionLink {
	labelKey: string;
	url: string;
}

export interface HttpErrorLinkDefinition {
	labelKey: string;
	url: string;
}

/**
 * Subset of {@link ProviderId} that has dedicated HTTP error links
 * (API key pages, balance/usage pages, status pages).
 */
export type ApiProviderId = Extract<ProviderId, 'deepseek' | 'minimaxi'>;
export type HttpErrorLinkStatusKey = 401 | 402 | '5xx';

export type DeepSeekRequestErrorKind = 'http' | 'network' | 'unknown';

export type NetworkErrorCategory =
	| 'dns'
	| 'unreachable'
	| 'interrupted'
	| 'timeout'
	| 'tls'
	| 'aborted'
	| 'protocol'
	| 'configuration'
	| 'generic';
