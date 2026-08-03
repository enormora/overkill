import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createEngine, type Engine } from '../engine/engine.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter.ts';

function readProcessExitCode(): number | string | null | undefined {
    return process.exitCode;
}

function writeProcessExitCode(exitCode: number): void {
    process.exitCode = exitCode;
}

export function createTestEngine(): Engine {
    const wallClock = createDeterministicWallClock();

    return createEngine({
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({ wallClock }),
            wallClock
        }),
        nodeVersion: process.versions.node,
        readExitCode: readProcessExitCode,
        wallClock,
        writeExitCode: writeProcessExitCode
    });
}
