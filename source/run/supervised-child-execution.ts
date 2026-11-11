import type { Clock } from '@enormora/clock';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { createExecute, type Execute, type ExecuteDependencies } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defineReporter, type DefinedReporter } from '../engine/reporter.ts';
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

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

type SupervisedExecutionCommand = Pick<
    SupervisedRunCommand,
    'benchmarkGarbageCollection' | 'benchmarkNormalization' | 'replay' | 'snapshots' | 'testFamily'
>;

async function supervisedBenchmarkEnvironment(
    command: SupervisedExecutionCommand
): Promise<ExecuteDependencies['benchmarkEnvironment']> {
    if (command.testFamily !== 'benchmark') {
        return null;
    }
    const { createBenchmarkExecutionEnvironment } = await import('./benchmark-execution-environment.ts');
    return createBenchmarkExecutionEnvironment(
        command.benchmarkGarbageCollection,
        'supervised-process',
        command.benchmarkNormalization
    );
}

export async function createSupervisedChildExecute(
    wallClock: Clock,
    command: SupervisedExecutionCommand
): Promise<Execute> {
    const benchmarkEnvironment = await supervisedBenchmarkEnvironment(command);
    const execute = createExecute({
        benchmarkEnvironment,
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes,
        reporterDispatcher: createReporterDispatcher({
            stderr: { writeLine: ignoreLine },
            stdout: { writeLine: ignoreLine },
            wallClock
        }),
        wallClock
    });
    return async function executeInReplayContext(plan, options) {
        return await withReplayWire(command.replay, async function executeAssignment() {
            return await execute(
                plan,
                options === undefined ? options : {
                    ...options,
                    outputRenderer: createPlainOutputRenderer(),
                    runtimePolicy: snapshotRuntimePolicy(options.runtimePolicy ?? null, command.snapshots)
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
