import { createDeterministicClock, type Clock } from '@enormora/clock';
import { createEngine, type Engine } from '../engine/engine.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';

function ignoreOutputLine(): void {
    return undefined;
}

function readNoActiveResourceTypes(): readonly string[] {
    return [];
}

export function createTimedTestEngine(wallClock: Clock): Engine {
    return createEngine({
        execute: createExecute({
            benchmarkEnvironment: null,
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

export function createTestEngine(): Engine {
    return createTimedTestEngine(createDeterministicClock({ initialUnixEpochMicroseconds: 0n }));
}
