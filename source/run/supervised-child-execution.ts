import type { Clock } from '@enormora/clock';
import type { BenchmarkExecutionEnvironment } from '../engine/benchmark-garbage-collection.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defineReporter } from '../engine/reporter.ts';
import type { DefinedReporter, Execute } from './run-engine-primitives.ts';
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

export async function createSupervisedChildExecute(
    wallClock: Clock,
    command: Pick<SupervisedRunCommand, 'benchmarkGarbageCollection' | 'testFamily'>
): Promise<Execute> {
    let benchmarkEnvironment: BenchmarkExecutionEnvironment | null = null;
    if (command.testFamily === 'benchmark') {
        const { createBenchmarkExecutionEnvironment } = await import('./benchmark-execution-environment.ts');
        benchmarkEnvironment = createBenchmarkExecutionEnvironment(
            command.benchmarkGarbageCollection,
            'supervised-process'
        );
    }
    return createExecute({
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
