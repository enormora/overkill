import { glob, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClock } from '@enormora/clock';
import { createDirectRuntimePolicy } from '../../run/direct-runtime-policy.ts';
import { defaultRunEngine } from '../../run/default-run-engine.ts';
import { createRunIfMain } from '../../run/run-if-main.ts';
import { createDirectProfileResolver } from '../../run/run-if-main-profile.ts';
import { createNodeResourceUsageTracker } from '../../run/resource-usage.ts';
import { loadRunConfig } from './config.entry-point.ts';

const resolveDirectProfile = createDirectProfileResolver({
    fileURLToPath,
    glob,
    loadRunConfig,
    realpath,
    stat
});

export const runIfMain = createRunIfMain({
    createResourceUsageTracker: createNodeResourceUsageTracker,
    createRuntimePolicy: createDirectRuntimePolicy,
    createClock,
    currentWorkingDirectory() {
        return process.cwd();
    },
    readExitCode() {
        return process.exitCode;
    },
    resolveDirectProfile,
    runEngine: defaultRunEngine,
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
    PlannedResourceOwner,
    ResourceOwnerPlacement,
    ResourceOwnershipPlan
} from '../../run/resource-ownership-plan.ts';
export type {
    LoadedRunConfig,
    RunConfigLoader,
    RunConfigLoaderDependencies,
    RunConfigLoadRequest,
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
export type { RuntimeDimensions, RuntimeId, WorkId, WorkloadId } from '../../engine/identity.ts';
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
    RunConfig,
    RunDebugRequest,
    RunEngineFacts,
    RunEngineSelection,
    RunEnvironmentFacts,
    RunExecutionRequest,
    RunFacts,
    RunFilter,
    RunExecutionFacts,
    RunHostProcess,
    RunHostProcessFacts,
    RunHostProcessReason,
    RunIntegrationExecution,
    RunIntegrationProfileConfig,
    RunLoaderConfig,
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
    RunSelection,
    RunShard,
    RunStringFilterField,
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
