import type { TestScope } from '@overkill-dev/test';
import { createStoredRunValue, collectedCasesByKey } from '../run/supervised-run-state.ts';
import {
    handleChildMessage,
    createReporterEventQueue,
    type SupervisedRunRuntime
} from '../run/supervised-run-runtime.ts';
import type { CollectedRunPlan } from '../run/run-types.ts';
import type {
    RunResult,
    RunArtifact,
    RunnerError,
    ReporterEvent,
    ProcessUsageSnapshot,
    WorkId
} from '../run/run-engine-primitives.ts';
import type { SupervisedChildMessage } from '../run/supervised-protocol.ts';
import { fakeWorkerRuntime, createCollectedPlan } from './worker-pool-execution-state.ts';
import { attachmentCoordinationForWork, captureCoordinatedAttachment } from './attachment-coordination.ts';
import { createFakeSupervisedChildProcess } from './fake-supervised-child-process.ts';
import { runResultFactory } from './run-result-factory.ts';

type RuntimeChildMessage = Exclude<SupervisedChildMessage, { readonly kind: 'timing'; }>;
type SupervisedMessageFixture = {
    readonly runtime: SupervisedRunRuntime;
    readonly plan: CollectedRunPlan;
    readonly work: WorkId;
    readonly reported: readonly ReporterEvent[];
    readonly receive: (message: RuntimeChildMessage) => void;
    readonly capture: () => Promise<RunArtifact>;
};
function firstCollectedWork(plan: CollectedRunPlan): WorkId {
    const first = collectedCasesByKey(plan).values().next().value;
    if (first?.workId === undefined) {
        throw new Error('Missing collected work.');
    }
    return first.workId;
}
function reporterError(): RunnerError {
    const error = runResultFactory
        .build({ runnerErrors: [ { message: 'Reporter delivery failed.', subtype: 'reporter' } ] })
        .runnerErrors[0];
    if (error === undefined) {
        throw new Error('Missing reporter error.');
    }
    return error;
}
export function supervisedMessageRuntime(
    scope: TestScope,
    reportingFailure: boolean,
    collected: boolean
): SupervisedMessageFixture {
    const original = fakeWorkerRuntime(createCollectedPlan());
    const work = firstCollectedWork(original.collectedPlan);
    const attachments = attachmentCoordinationForWork(null, [ work ]);
    scope.cleanup(attachments.coordinator.close);
    const reported: ReporterEvent[] = [];
    const runtime: SupervisedRunRuntime = {
        attachments: attachments.coordinator,
        child: createFakeSupervisedChildProcess({
            collect() {
                return { collectedPlan: original.collectedPlan, runnerErrors: [] };
            },
            run() {
                throw new Error('Message fixture cannot execute a child.');
            }
        }),
        collectedPlan: createStoredRunValue<CollectedRunPlan | null>(collected ? original.collectedPlan : null),
        completedResult: createStoredRunValue<RunResult | null>(null),
        dependencies: original.dependencies,
        async finalizeResult(result) {
            return result;
        },
        previousSample: createStoredRunValue<ProcessUsageSnapshot | null>(null),
        reporterDelivery: {
            async reportEvent(event) {
                reported.push(event);
                return reportingFailure ? [ reporterError() ] : [];
            },
            async reportResult() {
                return [];
            },
            async disposeReporters() {
                return [];
            }
        },
        reporterEvents: createReporterEventQueue(),
        resolvedRun: {
            ...original.resolvedRun,
            plan: { kind: 'supervised', collectedPlan: original.collectedPlan },
            facts: {
                ...original.resolvedRun.facts,
                execution: { ...original.resolvedRun.facts.execution, processModel: 'supervised-process' }
            }
        },
        state: original.runState,
        terminalFailure: createStoredRunValue(false),
        timeout: {
            clear() {
                return undefined;
            },
            start() {
                return undefined;
            }
        }
    };
    return {
        runtime,
        work,
        plan: original.collectedPlan,
        reported,
        receive(message) {
            handleChildMessage(message, runtime);
        },
        async capture() {
            return await captureCoordinatedAttachment(attachments.coordinator, work, { index: 0 }, null);
        }
    };
}
