import type { SerializedValue } from '../assertion-protocol/assertion-node-shape.ts';
import type { EncodedPropertyInput, PropertyWitnessFile } from './witness-file.ts';

type CodecErrorCapture = { readonly kind: 'codec-error'; readonly reason: string; };
type EncodedCapture = { readonly kind: 'encoded'; readonly input: EncodedPropertyInput; };
type UnavailableCapture = { readonly kind: 'unavailable'; };
type PropertyInputCapture = CodecErrorCapture | EncodedCapture | UnavailableCapture;

export type PropertyFailureObservation = {
    readonly capture: PropertyInputCapture;
    readonly input: SerializedValue;
    readonly failure: SerializedValue;
};

type ShrinkUnavailableReason = 'failure-identity-unavailable' | 'shrink-state-unavailable' | 'shrinking-disabled';
type ShrinkCompletion = 'non-reproducible' | 'search-exhausted' | 'work-exhausted';
type ShrinkInterruption = 'execution-error' | 'interrupted';
export type PropertyShrinkStatus = ShrinkCompletion | ShrinkInterruption | ShrinkUnavailableReason | 'in-progress';

export type PropertyInvocationEvidence = {
    readonly confirmedWitness: PropertyWitnessFile | null;
    readonly shrinkStatus: PropertyShrinkStatus | null;
    readonly identity: string;
    readonly original: PropertyFailureObservation;
    readonly retained: PropertyFailureObservation;
    readonly diagnostics: readonly {
        readonly reason: string;
        readonly observation: PropertyFailureObservation | null;
    }[];
};
