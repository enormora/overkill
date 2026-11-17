import type { FamilyRunFacts } from '../engine/family-run.ts';
import type { WitnessFile } from '../engine/witness-file.ts';
import type { LoaderConfig } from '../config/types.ts';
import type {
    currentRunRecordVersion,
    implementationRunRecordVersion,
    previousRunRecordVersion,
    familyRunRecordVersion
} from './run-record-format.ts';
import type { PlacementTrace } from './placement-trace.ts';
import type { RunRecordRequest, RunRecordResult } from './run-record-types.ts';
import type { CollectedRunPlan, RunFacts, WorkId, RunEngineFacts, RunHostProcessFacts } from './run-types.ts';

type RecordedWorkerCount = Extract<RunFacts['execution'], { readonly processModel: 'worker-pool'; }>['workerCount'];
type RecordedHost = RunHostProcessFacts | null;
type ExecutionIdentity = Pick<RunFacts['execution'], 'processModel' | 'scheduling' | 'testFamily'>;
type RecordedExecution = ExecutionIdentity & {
    readonly dispatchPolicy: 'dynamic-lease' | 'static-assignment' | null;
    readonly placementPlan: RunFacts['execution']['placementPlan'];
    readonly workerCount: RecordedWorkerCount | null;
    readonly hostProcess: RecordedHost;
};
type RecordedCalibration = Pick<RunFacts, 'benchmarkCalibration' | 'benchmarkHost'>;
type RecordedNormalization = Pick<RunFacts, 'benchmarkNormalization' | 'benchmarkPlacement'>;
type RecordedReproducibility = Pick<RunFacts, 'durationHistory' | 'reproducibility'>;
type RecordedWork = {
    readonly cases: readonly Pick<RunFacts['cases'][number], 'fileSet' | 'workId'>[];
    readonly execution: RecordedExecution;
};
type RecordedBenchmarkFacts = RecordedCalibration & RecordedNormalization;
export type ReplayPlanningFacts = RecordedBenchmarkFacts & RecordedReproducibility & RecordedWork & {
    readonly implementations: RunFacts['implementations'];
    readonly family: FamilyRunFacts | null;
};
type RecordedReplayResult = Pick<RunRecordResult, 'planStatus' | 'resourceChecks'> & {
    readonly perTest: readonly { readonly workId: WorkId; }[];
};
type ReplayRecordVersions = readonly [
    typeof currentRunRecordVersion,
    typeof implementationRunRecordVersion,
    typeof familyRunRecordVersion,
    typeof previousRunRecordVersion
];
export type ReplayRunRecord = {
    readonly version: ReplayRecordVersions[number];
    readonly kind: 'single';
    readonly id: string;
    readonly seed: string;
    readonly request: RunRecordRequest;
    readonly loader: LoaderConfig;
    readonly engine: Exclude<RunEngineFacts, { readonly kind: 'instance'; }>;
    readonly status: 'completed' | 'interrupted' | 'started';
    readonly replayPlan: CollectedRunPlan;
    readonly replayProfile: unknown;
    readonly replayWitness: WitnessFile | null;
    readonly identities: readonly WorkId[];
    readonly facts: ReplayPlanningFacts;
    readonly placementTrace: PlacementTrace | null;
    readonly result: RecordedReplayResult | null;
    readonly versions: { readonly node: string; readonly packages: Readonly<Record<string, string>>; };
};
