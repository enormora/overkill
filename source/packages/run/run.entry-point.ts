import { glob, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRunIfMain } from '../../run/run-if-main.ts';
import { createDirectProfileResolver } from '../../run/run-if-main-profile.ts';
import { runDirectEntrypoint } from '../../run/run-orchestrator.entry-point.ts';
import { loadConfig } from './config.entry-point.ts';

const resolveDirectProfile = createDirectProfileResolver({
    fileURLToPath,
    glob,
    loadConfig,
    realpath,
    stat
});

export const runIfMain = createRunIfMain({
    currentWorkingDirectory() {
        return process.cwd();
    },
    readExitCode() {
        return process.exitCode;
    },
    resolveDirectProfile,
    runDirectEntrypoint,
    setExitCode(exitCode) {
        process.exitCode = exitCode;
    },
    stderr: process.stderr
});

export { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
export {
    defineConfig,
    normalizeConfig,
    loadConfig,
    ConfigError
} from './config.entry-point.ts';
export { RunExecutionPlanError, RunResolutionError } from '../../run/run-errors.ts';
export type {
    IntegrationRetryPolicy,
    RetryArtifactPolicy,
    ProjectIntegrationRetryPolicy
} from './config.entry-point.ts';
export type {
    PlannedResourceOwner,
    ResourceOwnerPlacement,
    ResourceOwnershipPlan
} from '../../run/resource-ownership-plan.ts';
export type {
    LoadedConfig,
    ConfigLoader,
    ConfigLoaderDependencies,
    ConfigLoadRequest,
    ProjectCoverageOutput,
    ProjectCoveragePolicy,
    ProjectCoverageSources,
    ProjectCoverageThresholds,
    ProjectAttachmentLimits,
    Config,
    ProjectIntegrationExecution,
    ProjectIntegrationProfileConfig,
    ProjectMeasuredResourceUsage,
    ProjectMicrotestExecution,
    ProjectMicrotestProfileConfig,
    ProjectProfileFiles,
    ProjectProfileConfig,
    ProjectProfilesConfig,
    ProjectResourceBudgets,
    ProjectResourceUsageConfig,
    ProjectTimingProfilePolicy,
    ProjectTimeoutConfig,
    ProjectUnmeasuredResourceUsage
} from '../../config/config.ts';
export type {
    RunIfMain,
    RunIfMainDependencies
} from '../../run/run-if-main.ts';
export type {
    RunIfMainProfileResolver,
    RunIfMainProfileResolverDependencies
} from '../../run/run-if-main-profile.ts';
export type {
    RunIfMainOptions,
    RunIfMainRootOptions
} from '../../run/run-if-main-options.ts';
export type {
    ExecutionPlanResourceFacts,
    RunExecutionPlanConflict,
    RunResolutionErrorCode
} from '../../run/run-errors.ts';
export type { RunInvocationTimingOptions } from '../../run/run-timing-collection.ts';
export type {
    RuntimeDimensions,
    RuntimeId,
    RuntimeScenarioBindings,
    WorkId,
    WorkloadId
} from '../../engine/identity.ts';
export type {
    DynamicWorkUnitId,
    PlacementAttemptId,
    PlacementAttemptInterruptionCause,
    PlacementAttemptReason,
    PlacementRecoveryDecision,
    PlacementTrace,
    PlacementTraceEntry,
    PlacementWorkerId,
    TraceWorkUnitId
} from '../../run/placement-trace.ts';
export type {
    CollectedRunCase,
    CollectedRunFile,
    CollectedRunPlan,
    ExecutorDescriptor,
    PlacementAssignment,
    PlacementLane,
    PlacementPlan,
    ResolvedRun,
    ResolvedRunPlan,
    RunCaseFacts,
    RunCommand,
    RunDebugRequest,
    RunEngineFacts,
    RunEnvironmentFacts,
    RunExecutionRequest,
    RunFacts,
    RunExecutionFacts,
    RunHostProcessFacts,
    RunHostProcessReason,
    RunOrchestrator,
    RunReproducibilityFacts,
    RunRequest,
    RunSeed,
    RunShard,
    RunTestFamily,
    RunWorkerCountFacts,
    SerializedValue,
    DuplicateExecutionSafety,
    WorkUnitId,
    WorkUnit,
    WorkUnitMode
} from '../../run/run-types.ts';
export type {
    CoverageOutput,
    NormalizedConfig,
    CoveragePolicy,
    CoverageSourcePolicy,
    CoverageThresholds,
    HostProcess,
    IntegrationExecution,
    IntegrationProfileConfig,
    LoaderConfig,
    MaxConcurrency,
    MicrotestExecution,
    MicrotestProfileConfig,
    RunOrder,
    ProcessModel,
    ProfileConfig,
    BenchmarkProfileConfig,
    TestProfileConfig,
    ProfileFiles,
    ProfilesConfig,
    ResourceBudgets,
    ResourceUsagePolicy,
    Scheduling,
    TimeoutPolicy,
    TimingCollectionMode,
    TimingCollectionOverride,
    TimingProfilePolicy,
    WorkDistribution,
    WorkGroup,
    WorkGroupGranularity,
    WorkGroupOrder,
    WorkGroupScheduling,
    WorkGroupWorkerLifecycle,
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    WorkerPoolHedgingPolicy,
    WorkerLifecycle
} from '../../config/types.ts';
export type { RunEngineSelection } from '../../run/run-request-types.ts';
export type {
    RunFilter,
    RunRuntimeDimensionFilter,
    RunRuntimeFilter,
    RunRuntimeScenarioFilter,
    RunRuntimeVariantFilter,
    RunSelection,
    RunStringFilterField
} from '../../run/run-request-types.ts';
export type {
    ResolvedRuntime,
    RunRecord,
    RunRecordCoverage,
    RunRecordRequest,
    RunRecordResult,
    RunRecordVersions
} from '../../run/run-record-types.ts';

export type { ProjectBenchmarkProfileConfig } from '../../config/schema.ts';
