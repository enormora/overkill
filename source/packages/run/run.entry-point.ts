import { glob, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRunIfMain } from '../../run/run-if-main.ts';
import { createDirectProfileResolver } from '../../run/run-if-main-profile.ts';
import { runDirectEntrypoint } from '../../run/run-orchestrator.entry-point.ts';
import { loadRunConfig } from './config.entry-point.ts';

const resolveDirectProfile = createDirectProfileResolver({
    fileURLToPath,
    glob,
    loadRunConfig,
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
    loadRunConfig,
    RunConfigError
} from './config.entry-point.ts';
export { RunExecutionPlanError, RunResolutionError } from '../../run/run-errors.ts';
export type {
    IntegrationRetryPolicy,
    RetryArtifactPolicy,
    RunProjectIntegrationRetryPolicy
} from './config.entry-point.ts';
export type {
    PlannedResourceOwner,
    ResourceOwnerPlacement,
    ResourceOwnershipPlan
} from '../../run/resource-ownership-plan.ts';
export type {
    LoadedRunConfig,
    RunConfigLoader,
    RunConfigLoaderDependencies,
    RunConfigLoadRequest,
    RunProjectCoverageOutput,
    RunProjectCoveragePolicy,
    RunProjectCoverageSources,
    RunProjectCoverageThresholds,
    RunProjectConfig,
    RunProjectIntegrationExecution,
    RunProjectIntegrationProfileConfig,
    RunProjectMeasuredResourceUsage,
    RunProjectMicrotestExecution,
    RunProjectMicrotestProfileConfig,
    RunProjectProfileFiles,
    RunProjectProfileConfig,
    RunProjectProfilesConfig,
    RunProjectResourceBudgets,
    RunProjectResourceUsageConfig,
    RunProjectTimingProfilePolicy,
    RunProjectTimeoutConfig,
    RunProjectUnmeasuredResourceUsage
} from '../../run/run-config.ts';
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
    CoverageOutput,
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
    RunConfig,
    RunCoveragePolicy,
    RunCoverageSourcePolicy,
    RunCoverageThresholds,
    RunDebugRequest,
    RunEngineFacts,
    RunEnvironmentFacts,
    RunExecutionRequest,
    RunFacts,
    RunExecutionFacts,
    RunHostProcess,
    RunHostProcessFacts,
    RunHostProcessReason,
    RunIntegrationExecution,
    RunIntegrationProfileConfig,
    RunLoaderConfig,
    RunMaxConcurrency,
    RunMicrotestExecution,
    RunMicrotestProfileConfig,
    RunOrder,
    RunOrchestrator,
    RunProcessModel,
    RunProfileConfig,
    RunProfileFiles,
    RunProfilesConfig,
    RunResourceBudgets,
    RunResourceUsagePolicy,
    RunReproducibilityFacts,
    RunRequest,
    RunScheduling,
    RunSeed,
    RunShard,
    RunTestFamily,
    RunTimeoutPolicy,
    TimingCollectionMode,
    TimingCollectionOverride,
    TimingProfilePolicy,
    RunWorkDistribution,
    RunWorkGroup,
    RunWorkGroupGranularity,
    RunWorkGroupOrder,
    RunWorkGroupScheduling,
    RunWorkGroupWorkerLifecycle,
    RunWorkerPoolAssignmentPolicy,
    RunWorkerPoolDispatchPolicy,
    RunWorkerPoolHedgingPolicy,
    RunWorkerCountFacts,
    RunWorkerLifecycle,
    SerializedValue,
    DuplicateExecutionSafety,
    WorkUnitId,
    WorkUnit,
    WorkUnitMode
} from '../../run/run-types.ts';
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
