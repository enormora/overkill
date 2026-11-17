import type { FailedCheck, NonEmptyReadonlyArray } from './assertion-protocol/assertion-node-shape.ts';
import type { WorkId, AttemptId } from './engine/identity.ts';

export type ResourceCheckInterval = {
    readonly kind: 'attempt';
    readonly work: WorkId;
    readonly attempt: AttemptId;
} | {
    readonly kind: 'lifetime';
};
export type ResourceCheckIntervalContext = {
    readonly interval: ResourceCheckInterval;
    readonly signal: AbortSignal;
};
export type ResourceCheckCompleteness = {
    readonly kind: 'complete';
} | {
    readonly kind: 'incomplete';
    readonly reasons: readonly string[];
};
export type ResourceCheckFinding = {
    readonly kind: 'fail';
    readonly check: FailedCheck;
} | {
    readonly kind: 'pass';
};
export type ResourceCheckStopCause = { readonly kind: 'check'; readonly check: FailedCheck; } | {
    readonly kind: 'observation-error';
    readonly error: unknown;
};
export type ResourceCheckWriter = {
    readonly record: (interval: ResourceCheckInterval, target: string | null, finding: ResourceCheckFinding) => void;
    readonly error: (interval: ResourceCheckInterval, target: string | null, cause: unknown) => void;
    readonly requestStop: (
        interval: ResourceCheckInterval,
        target: string | null,
        cause: ResourceCheckStopCause
    ) => void;
};
export type ResourceCheckOwner = {
    readonly run: string;
    readonly id: string;
    readonly scope: 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker';
};
export type ResourceCheckSnapshot = {
    readonly owner: ResourceCheckOwner;
    readonly revision: number;
    readonly resource: string;
    readonly interval: ResourceCheckInterval;
    readonly passing: number;
    readonly failures: readonly {
        readonly target: string | null;
        readonly check: FailedCheck;
    }[];
    readonly errors: readonly {
        readonly interval: ResourceCheckInterval;
        readonly target: string | null;
        readonly cause: unknown;
    }[];
    readonly status: ResourceCheckCompleteness | {
        readonly kind: 'open';
    };
};

export type ResourceCheckFailure = {
    readonly kind: 'resource-check';
    readonly owner: ResourceCheckOwner;
    readonly resource: string;
    readonly interval: Extract<ResourceCheckInterval, { readonly kind: 'attempt'; }>;
    readonly failures: NonEmptyReadonlyArray<{ readonly target: string | null; readonly check: FailedCheck; }>;
};
