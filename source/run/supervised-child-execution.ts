import type { Clock } from '@enormora/clock';
import type { RuntimeExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defineReporter, type DefinedReporter } from '../engine/reporter.ts';
import { createHostExecutionDriver, type HostExecutionInput } from './host-family-plan.ts';
import { snapshotRuntimePolicy } from './snapshot-runtime.ts';
import { withReplayWire } from './replay-wire.ts';
import type { SupervisedChildMessage, SupervisedRunCommand } from './supervised-protocol.ts';
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

type SupervisedExecutionCommand = Pick<
    SupervisedRunCommand,
    'benchmarkGarbageCollection' | 'benchmarkNormalization' | 'replay' | 'snapshots' | 'testFamily'
>;

export async function createSupervisedChildExecute(
    wallClock: Clock,
    command: SupervisedExecutionCommand,
    sourcePlan: HostExecutionInput['sourcePlan']
): Promise<RuntimeExecute> {
    const execute = await createHostExecutionDriver({
        command,
        processModel: 'supervised-process',
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
            return options === undefined ? await execute(plan) : await execute(plan, {
                ...options,
                runtimePolicy: snapshotRuntimePolicy(options.runtimePolicy ?? null, command.snapshots)
            });
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
