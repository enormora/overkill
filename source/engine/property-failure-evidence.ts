import type { SerializedValue } from '../assertion-protocol/assertion-node-shape.ts';

export type PropertyFailureObservation = {
    readonly input: SerializedValue;
    readonly failure: SerializedValue;
};

type ShrinkUnavailableReason = 'failure-identity-unavailable' | 'shrink-state-unavailable' | 'shrinking-disabled';
type ShrinkCompletion = 'non-reproducible' | 'search-exhausted' | 'work-exhausted';
type ShrinkInterruption = 'execution-error' | 'interrupted';
export type PropertyShrinkStatus = ShrinkCompletion | ShrinkInterruption | ShrinkUnavailableReason | 'in-progress';

export type PropertyInvocationEvidence = {
    readonly shrinkStatus: PropertyShrinkStatus | null;
    readonly identity: string;
    readonly original: PropertyFailureObservation;
    readonly retained: PropertyFailureObservation;
    readonly diagnostics: readonly {
        readonly reason: string;
        readonly observation: PropertyFailureObservation | null;
    }[];
};
