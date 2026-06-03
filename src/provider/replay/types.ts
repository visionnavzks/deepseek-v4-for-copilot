export interface ReplayMarkerParseResult {
	valid: boolean;
	segmentId?: string;
	reasoningText?: string;
	reasoningTextIgnoredReason?: ReasoningMarkerTextIgnoredReason;
	legacySegmentOnly?: boolean;
	payloadFormat?: ReplayMarkerPayloadFormat;
	error?: string;
}

export interface LocatedReplayMarker {
	partIndex: number;
	marker: ReplayMarkerParseResult;
}

export type ReplayMarkerPayloadFormat = 'json-base64url' | 'raw-json' | 'raw-uuid';

export type ReasoningMarkerTextIgnoredReason =
	| 'reasoning-not-object'
	| 'reasoning-text-not-string'
	| 'reasoning-text-empty';

export interface ReplayMarkerMetadata {
	reasoningText?: string;
}
