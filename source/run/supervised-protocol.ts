import type { JsonValue } from 'type-fest';
import { createDefaultWorkId, workIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import type {
    BenchmarkProfileConfig,
    IntegrationProfileConfig,
    MaxConcurrency,
    ProcessBudgets,
    Scheduling
} from '../config/types.ts';
import { assertFrozenAssignmentInputs } from './workload-input-validation.ts';
import type {
    PropertyPolicy,
    FrozenWorkloadInput,
    RunFacts,
    FrozenMicrotestPolicy,
    CollectedRunPlan,
    RunCommand,
    RunRequest,
    RunCollectionRoot,
    RunTestFamily
} from './run-types.ts';
import type { RunExecutionTransport } from './execution-session-context.ts';
import type { ReporterEvent, RunResult, ProcessUsageSnapshot, TestPlan } from './run-engine-primitives.ts';
import type { AttachmentEndpoint } from './attachment-protocol.ts';
import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import {
    childProcessEnvelope,
    type ChildProcessEnvelope
} from './child-process-protocol.ts';

type RunEngineSelection = RunCommand['engine'];

type SupervisedCommandBase = {
    readonly benchmarkNormalization: RunFacts['benchmarkNormalization'];
    readonly benchmarkGarbageCollection: BenchmarkProfileConfig['garbageCollection'] | null;
    readonly propertyPolicy: PropertyPolicy | null;
    readonly retryPolicy: IntegrationProfileConfig['retries'];
    readonly capabilityRestrictions: {
        readonly mode: 'disabled' | 'enabled';
    };
    readonly capture: RunRequest['capture'];
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly engine: Exclude<RunEngineSelection, { readonly kind: 'instance'; }>;
    readonly paths: readonly string[];
    readonly hardTimeoutMilliseconds: number;
    readonly maxConcurrency: MaxConcurrency;
    readonly processBudgets: ProcessBudgets;
    readonly processUsageSamplingIntervalMilliseconds: number;
    readonly root: RunCollectionRoot;
    readonly scheduling: Scheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutMilliseconds: number;
};

type SupervisedCollectionMode = {
    readonly kind: 'collect';
} | { readonly kind: 'collect-frozen'; readonly policy: FrozenMicrotestPolicy; };
export type SupervisedExecutionMode = {
    readonly kind: 'run';
} | {
    readonly kind: 'run-frozen';
    readonly policy: FrozenMicrotestPolicy;
} | {
    readonly kind: 'run-session';
    readonly policy: FrozenMicrotestPolicy;
    readonly session: RunExecutionTransport;
};

export type SupervisedCollectCommand = SupervisedCollectionMode & SupervisedCommandBase;
export type SupervisedRunCommand = SupervisedCommandBase & SupervisedExecutionMode;

export type SupervisedChildCommand = SupervisedCollectCommand | SupervisedRunCommand;

export const supervisedChildCorrelationId = 'supervised-run';

type WorkAssignmentCommand = {
    readonly propertyPolicies: readonly { readonly work: WorkId; readonly policy: PropertyPolicy; }[];
    readonly workloadInputs: readonly FrozenWorkloadInput[];
    readonly attachmentEndpoint: AttachmentEndpoint | null;
    readonly assignedWork: readonly WorkId[];
    readonly kind: 'assign';
};

type LegacyCaseAssignmentCommand = {
    readonly attachmentEndpoint: AttachmentEndpoint | null;
    readonly assignedCases: readonly CaseId[];
    readonly kind: 'assign';
};

export type SupervisedAssignmentCommand = LegacyCaseAssignmentCommand | WorkAssignmentCommand;

function hasAssignedWork(assignment: SupervisedAssignmentCommand): assignment is WorkAssignmentCommand {
    return Object.hasOwn(assignment, 'assignedWork');
}

export function supervisedAssignedWork(assignment: SupervisedAssignmentCommand): readonly WorkId[] {
    return hasAssignedWork(assignment)
        ? assignment.assignedWork
        : assignment.assignedCases.map(createDefaultWorkId);
}

export type SupervisedChildMessage = {
    readonly collectedPlan: CollectedRunPlan;
    readonly kind: 'collected';
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
} | {
    readonly event: ReporterEvent;
    readonly kind: 'event';
} | {
    readonly kind: 'execution-data';
    readonly data: JsonValue;
} | {
    readonly kind: 'result';
    readonly result: RunResult;
} | {
    readonly kind: 'sample';
    readonly sample: ProcessUsageSnapshot;
} | {
    readonly kind: 'timing';
    readonly span: NonNullable<RunResult['timings']['precise']>['spans'][number];
};

export function supervisedChildEnvelope(
    message: SupervisedAssignmentCommand | SupervisedChildCommand | SupervisedChildMessage
): ChildProcessEnvelope<SupervisedAssignmentCommand | SupervisedChildCommand | SupervisedChildMessage> {
    return childProcessEnvelope(supervisedChildCorrelationId, message);
}

export function frozenSupervisedPolicy(command: SupervisedChildCommand): FrozenMicrotestPolicy | null {
    return command.kind === 'collect' || command.kind === 'run' ? null : command.policy;
}

function casesByIdentity(testPlan: TestPlan): ReadonlyMap<string, TestPlan['cases'][number]> {
    return new Map(testPlan.cases.map(function toEntry(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ];
    }));
}

function assignedTestPlanCase(
    casesByKey: ReadonlyMap<string, TestPlan['cases'][number]>,
    work: WorkId
): TestPlan['cases'][number] {
    const assigned = casesByKey.get(workIdentityKey(work));

    if (assigned === undefined) {
        throw new Error('Supervised child test plan did not match assigned work identities.');
    }

    return assigned;
}

function selectAssignedCases(
    testPlan: TestPlan,
    assignedWork: readonly WorkId[]
): TestPlan {
    const casesByKey = casesByIdentity(testPlan);
    const cases = assignedWork.map(function toAssignedCase(work) {
        return assignedTestPlanCase(casesByKey, work);
    });

    const first = cases[0];

    if (first === undefined) {
        throw new Error('Supervised child test plan did not match assigned work identities.');
    }

    return {
        ...testPlan,
        cases: [ first, ...cases.slice(1) ]
    };
}

function isWorkAssignment(assignment: SupervisedAssignmentCommand): assignment is WorkAssignmentCommand {
    return Object.hasOwn(assignment, 'assignedWork');
}

export function supervisedAssignedPlan(testPlan: TestPlan, assignment: SupervisedAssignmentCommand): TestPlan {
    const selected = selectAssignedCases(testPlan, supervisedAssignedWork(assignment));
    assertFrozenAssignmentInputs(
        selected,
        isWorkAssignment(assignment) ? assignment.workloadInputs : [],
        isWorkAssignment(assignment) ? assignment.propertyPolicies : []
    );
    return selected;
}
