import type { Except } from 'type-fest';
import type { SerializedValue } from '../compare/serialized-value.ts';
import type { CapturedOutputArtifact, HedgedConflictArtifact, TestFailure, TestOutcome } from '../engine/run-result.ts';
import type { CoverageArtifact } from '../engine/coverage-artifact.ts';

type RecordedThrownError = {
    readonly kind: 'body-error' | 'cleanup-error';
    readonly error: {
        readonly message: string;
        readonly name: string;
        readonly stack: string | null;
        readonly thrown: SerializedValue;
    };
};
type RecordedContractFailure = Except<Extract<TestFailure, { readonly kind: 'test-contract'; }>, 'actual'> & {
    readonly actual: SerializedValue;
};

type PreservedTestFailure = Exclude<TestFailure, { readonly kind: 'body-error' | 'cleanup-error' | 'test-contract'; }>;
export type RunRecordTestFailure = PreservedTestFailure | RecordedContractFailure | RecordedThrownError;

export type RunRecordTestOutcome = Exclude<TestOutcome, { readonly kind: 'fail'; }> | {
    readonly failures: readonly [RunRecordTestFailure, ...readonly RunRecordTestFailure[]];
    readonly kind: 'fail';
};

type RecordedConflictEvidence = {
    readonly outcome: RunRecordTestOutcome | null;
    readonly verdict: TestOutcome['kind'] | 'crashed' | 'resource-exhausted' | 'runtime-policy';
};
type RecordedConflictArtifact = Except<HedgedConflictArtifact, 'payload'> & {
    readonly payload: Except<HedgedConflictArtifact['payload'], 'authoritative' | 'conflicting'> & {
        readonly authoritative: RecordedConflictEvidence;
        readonly conflicting: RecordedConflictEvidence;
    };
};

export type RunRecordArtifact = CapturedOutputArtifact | CoverageArtifact | RecordedConflictArtifact;
