import type { Clock } from '@enormora/clock';
import { resolvedPropertyCorpus } from './property-corpus-execution.ts';
import { supervisedWorkloadInputs, type SupervisedRunRuntime } from './supervised-run-runtime.ts';
import { childProcessEnvelope, envelopeMessage } from './child-process-protocol.ts';
import { observeChildShutdown, startChildShutdown } from './child-process-shutdown.ts';
import { recordChildProtocolFailure, recordPrematureChildExit } from './supervised-child-failure.ts';
import { isSupervisedAnalysis, kill, type SupervisedChildProcess } from './supervised-child-process.ts';
import {
    supervisedChildCorrelationId,
    supervisedCancellationCorrelationId,
    type SupervisedChildMessage,
    type SupervisedChildCommand,
    type SupervisedAssignmentCommand
} from './supervised-protocol.ts';
import { supervisedChildMessageSchema } from './supervised-child-message-schema.ts';
import type { StoredRunValue, SupervisedRunState } from './supervised-run-state.ts';

type SupervisedTransport = {
    readonly analysis?: boolean;
    readonly accept: (message: SupervisedChildMessage) => boolean;
    readonly child: SupervisedChildProcess;
    readonly completed: () => boolean;
    readonly finished: () => void;
    readonly interrupted: () => void;
    readonly receive: (message: SupervisedChildMessage) => void;
    readonly restricted: boolean;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
    readonly wallClock: Clock;
};

type SupervisedObserver = {
    readonly cancel: (reason: string) => void;
    readonly fail: (reason: string, restricted: boolean) => void;
    readonly receive: (message: unknown) => void;
    readonly exit: () => void;
    readonly disconnect: () => void;
    readonly timeout: () => void;
};
function successfulChildExit(child: SupervisedChildProcess): boolean {
    return (child.exitCode === null || child.exitCode === 0) && child.signalCode === null;
}
function createSupervisedObserver(transport: SupervisedTransport): SupervisedObserver {
    const observations = { reportedFailure: false, boundaryFailure: false, analysisCancelled: false };
    function recordFailure(reason: string, restricted: boolean, termination: 'cancelled' | 'transport'): void {
        if (!observations.boundaryFailure) {
            transport.terminalFailure.write(true);
            observations.boundaryFailure = true;
            recordChildProtocolFailure(
                transport.state,
                reason,
                Number(transport.wallClock.currentMonotonicMicroseconds),
                { restricted, termination }
            );
        }
    }
    function fail(reason: string, restricted: boolean): void {
        if (observations.boundaryFailure) {
            return;
        }
        recordFailure(reason, restricted, 'transport');
        kill(transport.child);
        transport.interrupted();
    }
    function failureReport(message: SupervisedChildMessage): boolean {
        return message.kind === 'event' && message.event.kind === 'runner-error';
    }
    function terminalReport(message: SupervisedChildMessage): boolean {
        return message.kind === 'result' || failureReport(message);
    }
    function acceptsAfterFailure(message: SupervisedChildMessage): boolean {
        if (transport.analysis !== true) {
            return terminalReport(message);
        }
        return observations.analysisCancelled && failureReport(message);
    }

    function deliver(message: SupervisedChildMessage): void {
        if (transport.terminalFailure.read() && !acceptsAfterFailure(message)) {
            return;
        }
        if (!transport.accept(message)) {
            fail('Invalid supervised child IPC lifecycle.', transport.restricted);
            return;
        }
        if (failureReport(message)) {
            observations.reportedFailure = true;
        }
        transport.receive(message);
        if (transport.completed()) {
            startChildShutdown(transport.child);
        }
    }
    function receiveValidatedMessage(message: unknown): void {
        const decoded = envelopeMessage(message, supervisedChildCorrelationId, supervisedChildMessageSchema);
        if (decoded !== null) {
            deliver(decoded);
        } else if (transport.restricted) {
            fail('Runtime policy violation: unexpected supervised child IPC message.', true);
        }
    }
    function shouldReportPrematureExit(): boolean {
        return !observations.reportedFailure && !observations.boundaryFailure &&
            transport.state.runnerErrors().every(function alreadyReportedCrash(error) {
                return error.subtype !== 'crash';
            });
    }
    function recordIncompleteExit(): void {
        const alreadyFailed = transport.terminalFailure.read();
        transport.terminalFailure.write(true);
        if (alreadyFailed && successfulChildExit(transport.child) && !observations.reportedFailure) {
            transport.interrupted();
            return;
        }
        const observedAtMicroseconds = Number(transport.wallClock.currentMonotonicMicroseconds);
        if (shouldReportPrematureExit()) {
            recordPrematureChildExit(transport.child, transport.state, observedAtMicroseconds);
        } else {
            transport.state.recordTerminalActiveCases('crashed', observedAtMicroseconds);
        }
        transport.interrupted();
    }
    return {
        fail,
        cancel(reason) {
            recordFailure(reason, false, 'cancelled');
            if (transport.analysis === true) {
                observations.analysisCancelled = true;
                try {
                    transport.child.send(childProcessEnvelope(supervisedCancellationCorrelationId, { kind: 'cancel' }));
                } catch {
                    kill(transport.child);
                }
                startChildShutdown(transport.child);
            } else {
                kill(transport.child);
            }
            transport.interrupted();
        },
        timeout(): void {
            recordFailure('Supervised child shutdown exceeded one second.', false, 'transport');
            transport.interrupted();
        },
        receive(message): void {
            if (observations.boundaryFailure && !observations.analysisCancelled) {
                return;
            }
            try {
                receiveValidatedMessage(message);
            } catch (error: unknown) {
                fail(
                    error instanceof Error ? error.message : 'Invalid supervised child IPC payload.',
                    transport.restricted
                );
            }
        },
        exit(): void {
            if (!transport.completed() || !successfulChildExit(transport.child)) {
                recordIncompleteExit();
            }
        },
        disconnect(): void {
            if (!transport.completed()) {
                recordIncompleteExit();
                kill(transport.child);
            }
        }
    };
}
export function observeSupervisedTransport(transport: SupervisedTransport): (reason: string) => void {
    const observer = createSupervisedObserver(transport);
    transport.child.on('message', observer.receive);
    transport.child.on('error', function recordChildError(error: Error) {
        observer.fail(error.message, false);
    });
    transport.child.on('disconnect', observer.disconnect);
    observeChildShutdown(transport.child, transport.wallClock, observer.timeout, function finishAfterDraining() {
        observer.exit();
        transport.finished();
    });
    return function interruptSupervisedRun(reason) {
        observer.cancel(reason);
    };
}
export function sendSupervisedCommand(
    child: SupervisedChildProcess,
    command: SupervisedAssignmentCommand | SupervisedChildCommand
): void {
    child.send(childProcessEnvelope(supervisedChildCorrelationId, command));
}

export async function sendAssignmentForPlan(runtime: SupervisedRunRuntime): Promise<void> {
    const corpus = await resolvedPropertyCorpus(runtime.resolvedRun);
    sendSupervisedCommand(runtime.child, {
        corpus,
        implementations: runtime.resolvedRun.facts.implementations,
        ...isSupervisedAnalysis(runtime.resolvedRun)
            ? { analysisCollection: runtime.resolvedRun.facts.family?.collection ?? null }
            : {},
        assignedWork: runtime.resolvedRun.facts.cases.map(function toWorkId(testCase) {
            return testCase.workId;
        }),
        propertyPolicies: runtime.resolvedRun.facts.cases.flatMap(function propertyAssignment(testCase) {
            return testCase.propertyPolicy === null
                ? []
                : [ { work: testCase.workId, policy: testCase.propertyPolicy } ];
        }),
        workloadInputs: supervisedWorkloadInputs(runtime.resolvedRun),
        kind: 'assign',
        attachmentEndpoint: runtime.attachments?.endpoint ?? null
    });
}
