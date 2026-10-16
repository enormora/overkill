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
export { parseRunExecutionFailure } from '../../run/execution-failure-schema.ts';
export { runExecutionFailure, restoreRunExecutionFailure } from '../../run/execution-failure.ts';
export type { RunExecutionFailure } from '../../run/execution-failure-schema.ts';
export type {
    RunExecutionLifecycle,
    RunExecutionLifecycleFactory,
    RunExecutionSessionOptions
} from '../../run/run-types.ts';
export type {
    RunExecutionInvocation,
    RunExecutionReply,
    RunExecutionSession
} from '../../run/execution-session-types.ts';
export { parseFrozenMicrotestPolicy } from '../../run/frozen-run-policy.ts';
export { createRandomRunSeed } from '../../run/run-seed.ts';
export { parseRunSelection } from '../../run/run-selection-schema.ts';
export { parseRunResult, parseRunnerError } from '../../run/run-result-schema.ts';
export { workIdentityKey } from '../../engine/identity.ts';
export type { PerTestResult, RunnerError } from '../../run/run-engine-primitives.ts';
export { withFileModuleBoundary } from '../../run/file-module-boundary.ts';
export type { FileModuleBoundary } from '../../run/run-types.ts';
export type {
    FreezePolicyInput,
    FrozenMicrotestPolicy,
    FrozenRunCommand,
    RunPolicySource
} from '../../run/run-types.ts';
export {
    defineConfig,
    normalizeConfig,
    loadConfig,
    ConfigError
} from './config.entry-point.ts';
export { RunCollectionError, RunExecutionPlanError, RunResolutionError } from '../../run/run-errors.ts';
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
    ProjectMeasuredProcessUsage,
    ProjectMicrotestExecution,
    ProjectMicrotestProfileConfig,
    ProjectPropertyProfileConfig,
    ProjectProfileFiles,
    ProjectProfileConfig,
    ProjectProfilesConfig,
    ProjectProcessBudgets,
    ProjectProcessUsageConfig,
    ProjectTimingProfilePolicy,
    ProjectTimeoutConfig,
    ProjectUnmeasuredProcessUsage
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
    CollectedRun,
    CollectedRunInvocation,
    InitializedRun,
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
    RunInvocationOptions,
    RunDebugRequest,
    RunEngineFacts,
    RunEnvironmentFacts,
    RunExecutionRequest,
    RunFacts,
    RunExecutionFacts,
    RunHostProcessFacts,
    RunHostProcessReason,
    BenchmarkOrchestrator,
    BenchmarkBaselineCommand,
    BenchmarkBaselineListCommand,
    BenchmarkBaselineOrchestrator,
    BenchmarkBaselineRunResult,
    RunReporterDeliveryResult,
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
export type { RunOrchestrator } from '../../run/run-orchestrator-types.ts';
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
    BenchmarkExecution,
    BenchmarkProfileConfig,
    TestProfileConfig,
    PropertyProfileConfig,
    ProfileFiles,
    ProfilesConfig,
    ProcessBudgets,
    ProcessUsagePolicy,
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
export type { BenchmarkHostLimits, BenchmarkHostPolicy } from '../../config/benchmark-host.ts';
export type {
    BenchmarkHostAssessment,
    BenchmarkHostCheck,
    BenchmarkHostSnapshot,
    HostReading
} from '../../bench/benchmark-host-snapshot.ts';
