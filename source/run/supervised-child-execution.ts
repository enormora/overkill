import type { Clock } from '@enormora/clock';
import { currentLateAssertionSink, withLateAssertionFallback } from '../engine/late-assertion-delivery.ts';
import type { RuntimeExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defineReporter, type DefinedReporter } from '../engine/reporter.ts';
import { withAnalysisCollection } from './analysis-deadline.ts';
import { createHostExecutionDriver, type HostExecutionInput } from './host-family-execution.ts';
import { snapshotRuntimePolicy } from './snapshot-runtime.ts';
import { withReplayWire } from './replay-wire.ts';
import {
    assignedAnalysisCollection,
    type SupervisedAssignmentCommand,
    type SupervisedChildMessage,
    type SupervisedRunCommand
} from './supervised-protocol.ts';
import { createResourceLifecycleTiming, type ResourceLifecycleTiming } from './resource-lifecycle-timing.ts';

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

type SupervisedChildReporterHost = {
    readonly send: (message: SupervisedChildMessage) => void;
};

function ignoreLine(): void {
    return undefined;
}

type SupervisedExecutionCommand = {
    readonly command: Pick<
        SupervisedRunCommand,
        'benchmarkGarbageCollection' | 'benchmarkNormalization' | 'replay' | 'snapshots' | 'testFamily'
    >;
    readonly assignment: SupervisedAssignmentCommand;
};

export async function createSupervisedChildExecute(
    wallClock: Clock,
    input: SupervisedExecutionCommand,
    sourcePlan: HostExecutionInput['sourcePlan'],
    readActiveResourceTypes: HostExecutionInput['readActiveResourceTypes']
): Promise<RuntimeExecute> {
    const { command, assignment } = input;
    const execute = await createHostExecutionDriver({
        command,
        processModel: 'supervised-process',
        readActiveResourceTypes,
        sourcePlan,
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: ignoreLine },
            stdout: { writeLine: ignoreLine },
            wallClock
        }),
        wallClock
    });
    return async function executeInReplayContext(plan, options) {
        return await withReplayWire(command.replay, async function executeAssignment() {
            return await withAnalysisCollection(
                assignedAnalysisCollection(assignment),
                async function runAssignment() {
                    return options === undefined ? await execute(plan) : await execute(plan, {
                        ...options,
                        runtimePolicy: snapshotRuntimePolicy(options.runtimePolicy ?? null, command.snapshots)
                    });
                }
            );
        });
    };
}

export function createSupervisedChildReporter(host: SupervisedChildReporterHost): DefinedReporter {
    return defineReporter(function createIpcRuntimeReporter() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'supervised-child-ipc',
            onEvent(event) {
                if (event.kind !== 'run-start' && event.kind !== 'run-end') {
                    host.send({ event, kind: 'event' });
                }
            },
            onFinish: null,
            sinks: [ { kind: 'memory' } ]
        };
    });
}

export async function withSupervisedLateAssertionDelivery<Value>(
    host: SupervisedChildReporterHost,
    run: () => Promise<Value>
): Promise<Value> {
    const warn = currentLateAssertionSink();
    return await withLateAssertionFallback(function forwardLateAssertion(error) {
        if (!process.connected) {
            warn(error);
        } else {
            host.send({ kind: 'event', event: { kind: 'runner-error', error } });
        }
    }, run);
}
