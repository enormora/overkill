import type { TestRuntimePolicy as TestRuntimePolicyDefinition } from '../engine/case-execution.ts';
import type { AttachmentLimits as AttachmentLimitsDefinition } from '../engine/runtime-attachment.ts';
import type {
    AttemptId as AttemptIdDefinition,
    WorkId as WorkIdDefinition,
    RuntimeId as RuntimeIdDefinition,
    WorkloadId as WorkloadIdDefinition
} from '../engine/identity.ts';
import type { Engine as EngineDefinition } from '../engine/engine.ts';
import type { Execute as ExecuteDefinition } from '../engine/execution.ts';
import type {
    ReporterDelivery as ReporterDeliveryDefinition,
    ReporterDispatcher as ReporterDispatcherDefinition
} from '../engine/reporter-dispatcher.ts';
import type {
    DefinedReporter as DefinedReporterDefinition,
    ReporterEvent as ReporterEventDefinition
} from '../engine/reporter.ts';
import type {
    OrphanedNode as OrphanedNodeDefinition,
    PerTestResult as PerTestResultDefinition,
    RunArtifact as RunArtifactDefinition,
    RunResult as RunResultDefinition,
    RunnerError as RunnerErrorDefinition
} from '../engine/run-result.ts';
import type {
    ResourceUsageSnapshot as ResourceUsageSnapshotDefinition,
    RunResourceUsage as RunResourceUsageDefinition,
    RunResourceUsageTracker as RunResourceUsageTrackerDefinition
} from '../engine/resource-usage.ts';
import type {
    TestPlanRootOptions as TestPlanRootOptionsDefinition,
    TestPlan as TestPlanDefinition,
    TestPlanCase as TestPlanCaseDefinition
} from '../engine/test-plan.ts';

export type Engine = EngineDefinition;
export type Execute = ExecuteDefinition;
export type DefinedReporter = DefinedReporterDefinition;
export type PerTestResult = PerTestResultDefinition;
export type ReporterDelivery = ReporterDeliveryDefinition;
export type ReporterDispatcher = ReporterDispatcherDefinition;
export type ReporterEvent = ReporterEventDefinition;
export type ResourceUsageSnapshot = ResourceUsageSnapshotDefinition;
export type RunArtifact = RunArtifactDefinition;
export type RunResourceUsage = RunResourceUsageDefinition;
export type RunResourceUsageTracker = RunResourceUsageTrackerDefinition;
export type RunResult = RunResultDefinition;
export type RunnerError = RunnerErrorDefinition;
export type TestPlan = TestPlanDefinition;
export type TestPlanCase = TestPlanCaseDefinition;

export type TestRuntimePolicy = TestRuntimePolicyDefinition;
export type AttachmentLimits = AttachmentLimitsDefinition;
export type AttemptId = AttemptIdDefinition;
export type WorkId = WorkIdDefinition;
export type RuntimeId = RuntimeIdDefinition;
export type WorkloadId = WorkloadIdDefinition;
export type OrphanedNode = OrphanedNodeDefinition;
export type TestPlanRootOptions = TestPlanRootOptionsDefinition;
