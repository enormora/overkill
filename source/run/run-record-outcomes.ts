import type { Except } from 'type-fest';
import type { SerializedValue } from '../compare/serialized-value.ts';
import type { HedgedConflictArtifact, TestAttemptResult, TestFailure, TestOutcome } from '../engine/run-result.ts';
import type { CapturedOutputArtifact } from '../engine/run-artifact.ts';
import type { CoverageArtifact } from '../engine/coverage-artifact.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';

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
    readonly attachments: readonly RuntimeAttachmentArtifact[];
    readonly attempts: readonly [RunRecordTestAttempt, ...readonly RunRecordTestAttempt[]];
    readonly outcome: RunRecordTestOutcome | null;
    readonly verdict: TestOutcome['kind'] | 'crashed' | 'resource-exhausted' | 'runtime-policy';
};
export type RunRecordTestAttempt = Except<TestAttemptResult, 'outcome'> & {
    readonly outcome: RunRecordTestOutcome | null;
};
type RecordedConflictArtifact = Except<HedgedConflictArtifact, 'payload'> & {
    readonly payload: Except<HedgedConflictArtifact['payload'], 'authoritative' | 'conflicting'> & {
        readonly authoritative: RecordedConflictEvidence;
        readonly conflicting: RecordedConflictEvidence;
    };
};

type DiagnosticArtifact = CapturedOutputArtifact | RuntimeAttachmentArtifact;
export type RunRecordArtifact = CoverageArtifact | DiagnosticArtifact | RecordedConflictArtifact;
