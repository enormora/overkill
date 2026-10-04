import type { Clock } from '@enormora/clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defineReporter } from '../engine/reporter.ts';
import type { DefinedReporter, Execute } from './run-engine-primitives.ts';
import type { SupervisedChildMessage } from './supervised-protocol.ts';

type SupervisedChildReporterHost = {
    readonly send: (message: SupervisedChildMessage) => void;
};

function ignoreLine(): void {
    return undefined;
}

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

export function createSupervisedChildExecute(wallClock: Clock): Execute {
    return createExecute({
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
