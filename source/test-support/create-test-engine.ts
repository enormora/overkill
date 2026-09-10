import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createEngine, type Engine } from '../engine/engine.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';

function ignoreOutputLine(): void {
    return undefined;
}

function readNoActiveResourceTypes(): readonly string[] {
    return [];
}

export function createTestEngine(): Engine {
    const wallClock = createDeterministicWallClock();

    return createEngine({
        execute: createExecute({
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes: readNoActiveResourceTypes,
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: ignoreOutputLine },
                stdout: { writeLine: ignoreOutputLine },
                wallClock
            }),
            wallClock
        }),
        wallClock
    });
}
