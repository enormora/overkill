import type { Clock } from '@enormora/clock';
import { createDefaultWorkId, type CaseId, type WorkId } from '../engine/identity.ts';
import type { RunTimingSpan } from '../engine/run-timings.ts';
import type { IntegrationProfileConfig, MaxConcurrency, ResourceBudgets, Scheduling } from '../config/types.ts';
import type { ReporterEvent, RunResult, ResourceUsageSnapshot } from './run-engine-primitives.ts';
import type { AttachmentEndpoint } from './attachment-protocol.ts';
import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import type { CollectedRunPlan, RunCommand, RunRequest, RunCollectionRoot, RunTestFamily } from './run-types.ts';
import {
    childProcessEnvelope,
    type ChildProcessEnvelope
} from './child-process-protocol.ts';
import {
    createResourceLifecycleTiming,
    type ResourceLifecycleTiming
} from './resource-lifecycle-timing.ts';

type RunEngineSelection = RunCommand['engine'];

type SupervisedCommandBase = {
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
    readonly resourceBudgets: ResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly root: RunCollectionRoot;
    readonly scheduling: Scheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutMilliseconds: number;
};

export type SupervisedCollectCommand = SupervisedCommandBase & {
    readonly kind: 'collect';
};

export type SupervisedRunCommand = SupervisedCommandBase & {
    readonly kind: 'run';
};

export type SupervisedChildCommand = SupervisedCollectCommand | SupervisedRunCommand;

export const supervisedChildCorrelationId = 'supervised-run';

type WorkAssignmentCommand = {
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
    readonly kind: 'result';
    readonly result: RunResult;
} | {
    readonly kind: 'sample';
    readonly sample: ResourceUsageSnapshot;
} | {
    readonly kind: 'timing';
    readonly span: RunTimingSpan;
};

export function createSupervisedResourceLifecycleTiming(
    clock: Clock,
    send: (message: SupervisedChildMessage) => void
): ResourceLifecycleTiming {
    return createResourceLifecycleTiming({
        clock,
        processId: String(process.pid),
        target: {
            emit(span) {
                send({ kind: 'timing', span });
            },
            kind: 'local'
        },
        workerId: null
    });
}

export function supervisedChildEnvelope(
    message: SupervisedAssignmentCommand | SupervisedChildCommand | SupervisedChildMessage
): ChildProcessEnvelope<SupervisedAssignmentCommand | SupervisedChildCommand | SupervisedChildMessage> {
    return childProcessEnvelope(supervisedChildCorrelationId, message);
}
