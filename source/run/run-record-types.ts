import type { Except } from 'type-fest';
import type { RuntimeId, WorkId } from '../engine/identity.ts';
import type { RunnerError, RunResult } from '../engine/run-result.ts';
import type { SerializedValue } from '../compare/serialized-value.ts';
import type { RunRecordArtifact, RunRecordTestAttempt, RunRecordTestOutcome } from './run-record-outcomes.ts';
import type { PlacementTrace } from './placement-trace.ts';
import type {
    RunCoveragePolicy,
    RunEngineFacts,
    RunEnvironmentFacts,
    RunFacts,
    RunLoaderConfig,
    RunProfileConfig,
    RunRequest
} from './run-types.ts';

export type RunRecordCoverage = {
    readonly directory: string;
    readonly policy: RunCoveragePolicy;
    readonly rawDataDirectory: string;
};

export type RunRecordVersions = {
    readonly engine: string | null;
    readonly node: string;
    readonly packages: Readonly<Record<string, string>>;
};

export type ResolvedRuntime = {
    readonly adapters: readonly { readonly name: string; readonly version: string; }[];
    readonly id: RuntimeId;
    readonly machineClass: string | null;
    readonly nodeVersion: string | null;
    readonly os: string | null;
};

type RecordedTestResult = Except<RunResult['perTest'][number], 'attempts' | 'outcome'> & {
    readonly attempts: readonly [RunRecordTestAttempt, ...readonly RunRecordTestAttempt[]];
    readonly outcome: RunRecordTestOutcome | null;
};

export type RunRecordResult = Except<RunResult, 'artifacts' | 'perTest' | 'runnerErrors'> & {
    readonly artifacts: readonly RunRecordArtifact[];
    readonly perTest: readonly RecordedTestResult[];
    readonly runnerErrors: readonly (Except<RunnerError, 'cause'> & { readonly cause: SerializedValue; })[];
};

export type RunRecordRequest = Except<RunRequest, 'seed'> & {
    readonly seed: { readonly value: string; };
};

type RunRecordInputs = {
    readonly coverage: RunRecordCoverage | null;
    readonly cwd: string;
    readonly engine: RunEngineFacts;
    readonly environment: RunEnvironmentFacts;
    readonly execution: RunProfileConfig['execution'];
    readonly facts: RunFacts | null;
    readonly id: string;
    readonly identities: readonly WorkId[];
    readonly kind: 'single';
    readonly loader: RunLoaderConfig;
    readonly placementTrace: PlacementTrace | null;
    readonly request: RunRecordRequest;
    readonly runtime: ResolvedRuntime | null;
    readonly seed: string;
    readonly startedAt: string;
    readonly version: 1;
    readonly versions: RunRecordVersions;
};

type CompletedRunRecord = RunRecordInputs & {
    readonly result: RunRecordResult;
    readonly status: 'completed';
};
type StartedRunRecord = RunRecordInputs & {
    readonly result: RunRecordResult | null;
    readonly status: 'interrupted' | 'started';
};

export type RunRecord = CompletedRunRecord | StartedRunRecord;
