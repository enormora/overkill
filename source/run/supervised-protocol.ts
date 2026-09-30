import type { Clock } from '@enormora/clock';
import { createDefaultWorkId, type CaseId, type WorkId } from '../engine/identity.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import type { RunTimingSpan } from '../engine/run-timings.ts';
import type { ResourceUsageSnapshot, RunResult } from '../engine/run-result.ts';
import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import type {
    CollectedRunPlan,
    RunCommand,
    RunRequest,
    RunMaxConcurrency,
    RunResourceBudgets,
    RunCollectionRoot,
    RunScheduling,
    RunTestFamily
} from './run-types.ts';
import {
    childProcessEnvelope,
    envelopeMessage,
    type ChildProcessEnvelope
} from './child-process-protocol.ts';
import {
    createResourceLifecycleTiming,
    type ResourceLifecycleTiming
} from './resource-lifecycle-timing.ts';

export type SupervisedTimingRecorder = {
    readonly recordLocal: (span: RunTimingSpan) => void;
};

type RunEngineSelection = RunCommand['engine'];

type SupervisedCommandBase = {
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
    readonly maxConcurrency: RunMaxConcurrency;
    readonly resourceBudgets: RunResourceBudgets;
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly root: RunCollectionRoot;
    readonly scheduling: RunScheduling;
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
    readonly assignedWork: readonly WorkId[];
    readonly kind: 'assign';
};

type LegacyCaseAssignmentCommand = {
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

export function supervisedChildMessage(value: unknown): SupervisedChildMessage | null {
    return envelopeMessage<SupervisedChildMessage>(value, supervisedChildCorrelationId);
}
