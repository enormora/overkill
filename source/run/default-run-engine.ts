import { createWallClock } from '@enormora/wall-clock';
import { createEngineWithOwner, type Engine, type EngineDependencies } from '../engine/engine.ts';
import { createExecute } from '../engine/execution.ts';
import { formatCaseId } from '../engine/identity.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defaultTestNodeOwner } from '../engine/test-node.ts';

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

function createEngineDependencies(): EngineDependencies {
    const wallClock = createWallClock();

    return {
        execute: createExecute({
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes,
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: writeStderrLine },
                stdout: { writeLine: writeStdoutLine },
                wallClock
            }),
            wallClock
        }),
        wallClock
    };
}

const engine = createEngineWithOwner(createEngineDependencies(), defaultTestNodeOwner());

export const defaultRunEngine: Engine = {
    createRoot: engine.createRoot,
    createSuite: engine.createSuite,
    createSkippedTestCase: engine.createSkippedTestCase,
    createTable: engine.createTable,
    createTestCase: engine.createTestCase,
    createTestPlan: engine.createTestPlan,
    createTestPlanFromTestFiles: engine.createTestPlanFromTestFiles,
    execute: engine.execute,
    formatCaseId,
    ownsTestNode: engine.ownsTestNode
};
