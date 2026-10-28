import { createClock } from '@enormora/clock';
import { createEngineWithOwner, type Engine, type EngineDependencies } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import { createTestNodeOwner, defaultTestNodeOwner } from './test-node.ts';

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
    const wallClock = createClock();

    return {
        execute: createExecute({
            benchmarkEnvironment: null,
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

export function createEngine(): Engine {
    return createEngineWithOwner(createEngineDependencies(), createTestNodeOwner());
}

const defaultEngineKey = Symbol.for('@overkill-dev/engine/defaultEngine');
const engineMethods: readonly (keyof Engine)[] = [
    'createPropertyTestCase',
    'createBenchmarkTestCase',
    'createRoot',
    'createSuite',
    'createSkippedTestCase',
    'createTable',
    'createTestCase',
    'createThrowingTestCase',
    'createWorkloadTestCase',
    'createTestPlan',
    'createTestPlanFromTestFiles',
    'execute',
    'formatCaseId',
    'ownsTestNode'
];

function isEngine(value: unknown): value is Engine {
    return typeof value === 'object' && value !== null && engineMethods.every(function (name) {
        return typeof Reflect.get(value, name) === 'function';
    });
}

function sharedDefaultEngine(): Engine {
    const existing: unknown = Reflect.get(globalThis, defaultEngineKey);

    if (isEngine(existing)) {
        return existing;
    }

    const engine = createEngineWithOwner(createEngineDependencies(), defaultTestNodeOwner());
    Reflect.set(globalThis, defaultEngineKey, engine);

    return engine;
}

export const defaultEngine = sharedDefaultEngine();
