import type { SerializedValue } from '../assertion-protocol/assertion-node-shape.ts';
import type { EncodedPropertyInput, PropertyWitnessFile } from './witness-file.ts';

type CodecErrorCapture = { readonly kind: 'codec-error'; readonly reason: string; };
type EncodedCapture = { readonly kind: 'encoded'; readonly input: EncodedPropertyInput; };
type UnavailableCapture = { readonly kind: 'unavailable'; };
type PropertyInputCapture = CodecErrorCapture | EncodedCapture | UnavailableCapture;

export type PropertyFailureObservation = {
    readonly trial: PropertyTrialPosition | null;
    readonly capture: PropertyInputCapture;
    readonly input: SerializedValue;
    readonly failure: SerializedValue;
};

type ShrinkUnavailableReason = 'failure-identity-unavailable' | 'shrink-state-unavailable' | 'shrinking-disabled';
type ShrinkCompletion = 'non-reproducible' | 'search-exhausted' | 'work-exhausted';
type ShrinkInterruption = 'execution-error' | 'interrupted';
export type PropertyShrinkStatus = ShrinkCompletion | ShrinkInterruption | ShrinkUnavailableReason | 'in-progress';

type PropertyInvocationDetails = {
    readonly summary: PropertyInvocationSummary | null;
    readonly confirmedWitness: PropertyWitnessFile | null;
    readonly shrinkStatus: PropertyShrinkStatus | null;
    readonly identity: string;
    readonly diagnostics: readonly {
        readonly reason: string;
        readonly observation: PropertyFailureObservation | null;
    }[];
};

type PropertyObservations = { readonly original: null; readonly retained: null; } | {
    readonly original: PropertyFailureObservation;
    readonly retained: PropertyFailureObservation;
};

export type PropertyInvocationEvidence = PropertyInvocationDetails & PropertyObservations;

export type PropertyPhase = (readonly [
    'checked-in-corpus',
    'local-cache',
    'examples',
    'automatic-edges',
    'exhaustive',
    'exploration',
    'confirmation',
    'shrinking',
    'witness'
])[number];
export type PropertyTrialPosition = { readonly phase: PropertyPhase; readonly index: number; };
export type PropertyInvocationSummary = {
    readonly status: (readonly [
        'in-progress',
        'completed',
        'failed',
        'coverage-unmet',
        'generation-exhausted',
        'work-exhausted',
        'execution-error',
        'interrupted'
    ])[number];
    readonly trial: PropertyTrialPosition | null;
    readonly runSeed: string;
    readonly propertySeed: string;
    readonly witnessSeed: string | null;
    readonly seedVersion: 'property-v1';
    readonly accounting: {
        readonly phases: Readonly<Record<PropertyPhase, { readonly executed: number; readonly rejected: number; }>>;
        readonly workConsumed: number;
    };
    readonly coverage: {
        readonly phaseDenominators: Readonly<Record<string, number>>;
        readonly eligibleHits: Readonly<Record<string, number>>;
        readonly denominator: number;
        readonly requirements: readonly { readonly label: string; readonly minimumPercent: number; }[];
        readonly phases: Readonly<Record<string, Readonly<Record<string, number>>>>;
    };
    readonly exhaustive: {
        readonly domainSize: number;
        readonly executed: number;
        readonly traversal: 'complete' | 'incomplete';
    } | null;
};
