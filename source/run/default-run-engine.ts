import { createClock } from '@enormora/clock';
import { calibrationCapturePlan as captureCalibrationPlan } from '../engine/benchmark-calibration-plan.ts';
import type { BenchmarkNormalizationContext } from '../engine/benchmark-result.ts';
import { createEngineWithOwner, type Engine, type EngineDependencies } from '../engine/engine.ts';
import { createExecute } from '../engine/execution.ts';
import { formatCaseId } from '../engine/identity.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { defaultTestNodeOwner } from '../engine/test-node.ts';
import { RunCollectionError } from './run-errors.ts';

type TestPlan = ReturnType<Engine['createTestPlan']>;

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

const engine = createEngineWithOwner(createEngineDependencies(), defaultTestNodeOwner());

export const defaultRunEngine: Engine = {
    createPropertyTestCase: engine.createPropertyTestCase,
    createBenchmarkTestCase: engine.createBenchmarkTestCase,
    createRoot: engine.createRoot,
    createSuite: engine.createSuite,
    createSkippedTestCase: engine.createSkippedTestCase,
    createTable: engine.createTable,
    createTestCase: engine.createTestCase,
    createThrowingTestCase: engine.createThrowingTestCase,
    createWorkloadTestCase: engine.createWorkloadTestCase,
    createTestPlan: engine.createTestPlan,
    createTestPlanFromTestFiles: engine.createTestPlanFromTestFiles,
    execute: engine.execute,
    prepareFamily: engine.prepareFamily,
    formatCaseId,
    ownsTestNode: engine.ownsTestNode
};

export function calibrationCapturePlan(testPlan: TestPlan, context: BenchmarkNormalizationContext | null): TestPlan {
    const capture = context?.mode === 'capture';
    try {
        return captureCalibrationPlan(testPlan, capture);
    } catch (error: unknown) {
        throw RunCollectionError.fromPlan(error, 'Failed to collect benchmark calibration.');
    }
}
