import type { Clock } from '@enormora/clock';
import { childProcessEnvelope, envelopeMessage } from './child-process-protocol.ts';
import { observeChildShutdown, startChildShutdown } from './child-process-shutdown.ts';
import { recordChildProtocolFailure, recordPrematureChildExit } from './supervised-child-failure.ts';
import { kill, type SupervisedChildProcess } from './supervised-child-process.ts';
import {
    supervisedChildCorrelationId,
    type SupervisedChildMessage,
    type SupervisedChildCommand,
    type SupervisedAssignmentCommand
} from './supervised-protocol.ts';
import { supervisedChildMessageSchema } from './supervised-protocol-schema.ts';
import type { StoredRunValue, SupervisedRunState } from './supervised-run-state.ts';

type SupervisedTransport = {
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
    const observations = { reportedFailure: false, boundaryFailure: false };
    function recordFailure(reason: string, restricted: boolean): void {
        if (!observations.boundaryFailure) {
            transport.terminalFailure.write(true);
            observations.boundaryFailure = true;
            recordChildProtocolFailure(
                transport.state,
                reason,
                Number(transport.wallClock.currentMonotonicMicroseconds),
                restricted
            );
        }
    }
    function fail(reason: string, restricted: boolean): void {
        if (observations.boundaryFailure) {
            return;
        }
        recordFailure(reason, restricted);
        kill(transport.child);
        transport.interrupted();
    }
    function failureReport(message: SupervisedChildMessage): boolean {
        return message.kind === 'event' && message.event.kind === 'runner-error';
    }
    function terminalReport(message: SupervisedChildMessage): boolean {
        return message.kind === 'result' || failureReport(message);
    }
    function deliver(message: SupervisedChildMessage): void {
        if (transport.terminalFailure.read() && !terminalReport(message)) {
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
        timeout(): void {
            recordFailure('Supervised child shutdown exceeded one second.', false);
            transport.interrupted();
        },
        receive(message): void {
            if (observations.boundaryFailure) {
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
export function observeSupervisedTransport(transport: SupervisedTransport): void {
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
}
export function sendSupervisedCommand(
    child: SupervisedChildProcess,
    command: SupervisedAssignmentCommand | SupervisedChildCommand
): void {
    child.send(childProcessEnvelope(supervisedChildCorrelationId, command));
}
