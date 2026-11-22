import type { Except } from 'type-fest';
import type { RunRecordHeader } from '../run-record-header.ts';
import type { WitnessFile } from '../engine/witness-file.ts';
import type { RuntimeId, WorkId } from '../engine/identity.ts';
import type { RunnerError, RunResult, BaselineReportSummary } from '../engine/run-result.ts';
import type { SerializedValue } from '../compare/serialized-value.ts';
import type { CoveragePolicy, LoaderConfig, ProfileConfig } from '../config/types.ts';
import type { RunRecordArtifact, RunRecordTestAttempt, RunRecordTestOutcome } from './run-record-outcomes.ts';
import type { PlacementTrace } from './placement-trace.ts';
import type {
    RunEngineFacts,
    RunEnvironmentFacts,
    RunFacts,
    RunRequest,
    CollectedRunPlan,
    RunSingleProcessExecutionFacts,
    RunWorkerPoolExecutionFacts
} from './run-types.ts';

export type RunRecordCoverage = {
    readonly directory: string;
    readonly policy: CoveragePolicy;
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

type RunRecordInputs = Except<RunRecordHeader<'single'>, 'detail' | 'status'> & {
    readonly coverage: RunRecordCoverage | null;
    readonly cwd: string;
    readonly engine: RunEngineFacts;
    readonly environment: RunEnvironmentFacts;
    readonly execution: ProfileConfig['execution'];
    readonly facts: RunFacts | null;
    readonly identities: readonly WorkId[];
    readonly detail: 'detailed';
    readonly loader: LoaderConfig;
    readonly placementTrace: PlacementTrace | null;
    readonly request: RunRecordRequest;
    readonly runtime: ResolvedRuntime | null;
    readonly seed: string;
    readonly versions: RunRecordVersions;
    readonly replayPlan: CollectedRunPlan | null;
    readonly replayProfile: unknown;
    readonly replayWitness: WitnessFile | null;
};

type CompletedRunRecord = RunRecordInputs & {
    readonly result: RunRecordResult;
    readonly status: 'completed';
};
type StartedRunRecord = RunRecordInputs & {
    readonly result: RunRecordResult | null;
    readonly status: 'interrupted' | 'started';
};

export type SingleRunRecord = CompletedRunRecord | StartedRunRecord;
export type RunRecord = CompactRunRecord | MergedRunRecord | SingleRunRecord;

export type MergeRunFacts = Except<RunFacts, 'family'> & { readonly family: RunFacts['family'] | null; };

type MergedRecordLineage = { readonly id: string; readonly path: string; };
type MergedRunFields = Except<RunRecordHeader<'merged'>, 'detail' | 'status'> & {
    readonly detail: 'detailed';
    readonly facts: MergeRunFacts;
    readonly identities: readonly WorkId[];
    readonly lineage: readonly [MergedRecordLineage, ...(readonly MergedRecordLineage[])];
    readonly runtime: readonly [ResolvedRuntime | null, ...readonly (ResolvedRuntime | null)[]];
    readonly versions: Pick<RunRecordVersions, 'engine' | 'packages'>;
    readonly result: RunRecordResult;
};

type MergedLifecycle = { readonly status: 'completed'; } | { readonly status: 'interrupted' | 'started'; };
export type MergedRunRecord = MergedLifecycle & MergedRunFields;

type CompactSingleExecution = Pick<RunSingleProcessExecutionFacts, 'processModel' | 'scheduling'>;
type CompactWorkerExecution = Pick<RunWorkerPoolExecutionFacts, 'processModel' | 'scheduling' | 'workerLifecycle'>;
type CompactExecution = CompactSingleExecution | CompactWorkerExecution;
type CompactTestFields = 'benchmark' | 'durationMicroseconds' | 'verdict' | 'workId';
type CompactTestResult = Pick<RunRecordResult['perTest'][number], CompactTestFields>;
export type CompactRunResult = {
    readonly status: RunRecordResult['status'];
    readonly summary: RunRecordResult['summary'];
    readonly preparationFacts: RunRecordResult['preparationFacts'];
    readonly resourceChecks: RunRecordResult['resourceChecks'];
    readonly timings: Pick<RunRecordResult['timings'], 'summary'>;
    readonly runnerErrors: RunResult['runnerErrors'];
    readonly baselineReports: readonly BaselineReportSummary[];
    readonly perTest: readonly CompactTestResult[];
};
type CompactRunFacts = {
    readonly family: RunFacts['family'] | null;
    readonly benchmarkHost: RunFacts['benchmarkHost'];
    readonly benchmarkPlacement: RunFacts['benchmarkPlacement'];
    readonly benchmarkCalibration: RunFacts['benchmarkCalibration'];
    readonly benchmarkNormalization: RunFacts['benchmarkNormalization'];
    readonly environment: Pick<RunEnvironmentFacts, 'node'> | null;
    readonly execution: CompactExecution & { readonly testFamily: string; readonly profile: string; };
    readonly implementations: null;
};
type CompactRunFields = Except<RunRecordHeader<'merged' | 'single'>, 'detail' | 'status'> & {
    readonly detail: 'compact';
    readonly evidence: 'summaries';
    readonly replayPlan: null;
    readonly replayProfile: null;
    readonly versions: Pick<RunRecordVersions, 'engine' | 'packages'> & { readonly node: string | null; } | null;
    readonly identities: readonly WorkId[] | null;
    readonly execution: CompactExecution;
    readonly request: Pick<RunRecordRequest, 'profile' | 'recordForMerge'>;
    readonly facts: CompactRunFacts | null;
};
type CompletedCompactRunRecord = CompactRunFields & {
    readonly status: 'completed';
    readonly result: CompactRunResult;
};
type StartedCompactRunRecord = CompactRunFields & {
    readonly status: 'interrupted' | 'started';
    readonly result: CompactRunResult | null;
};
export type CompactRunRecord = CompletedCompactRunRecord | StartedCompactRunRecord;
