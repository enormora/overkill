import { createWallClock } from '@enormora/wall-clock';
import { createEngineWithOwner, type Engine, type EngineDependencies } from '../engine/engine.ts';
import { createExecute } from '../engine/execution.ts';
import { formatCaseId } from '../engine/identity.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defaultTestNodeOwner } from '../engine/test-node.ts';

function readProcessExitCode(): number | string | null | undefined {
    return process.exitCode;
}

function writeProcessExitCode(exitCode: number): void {
    process.exitCode = exitCode;
}

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

function createEngineDependencies(): EngineDependencies {
    const wallClock = createWallClock();

    return {
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: writeStderrLine },
                stdout: { writeLine: writeStdoutLine },
                wallClock
            }),
            wallClock
        }),
        nodeVersion: process.versions.node,
        readExitCode: readProcessExitCode,
        wallClock,
        writeExitCode: writeProcessExitCode
    };
}

const engine = createEngineWithOwner(createEngineDependencies(), defaultTestNodeOwner());

export const defaultRunEngine: Engine = {
    createRoot: engine.createRoot,
    createSuite: engine.createSuite,
    createTable: engine.createTable,
    createTestCase: engine.createTestCase,
    createTestPlan: engine.createTestPlan,
    createTestPlanFromTestFiles: engine.createTestPlanFromTestFiles,
    execute: engine.execute,
    formatCaseId,
    ownsTestNode: engine.ownsTestNode,
    runIfMain: engine.runIfMain
};
