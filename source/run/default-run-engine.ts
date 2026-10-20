import { createClock } from '@enormora/clock';
import type { BenchmarkNormalizationContext } from '../engine/benchmark-result.ts';
import { readTestBodyResourceAttachments } from '../engine/test-body-resource-attachment.ts';
import { readBenchmarkCalibrationBody } from '../engine/benchmark-node.ts';
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
    formatCaseId,
    ownsTestNode: engine.ownsTestNode
};

export function calibrationCapturePlan(testPlan: TestPlan, context: BenchmarkNormalizationContext | null): TestPlan {
    if (context?.mode !== 'capture') {
        return testPlan;
    }
    const captureCase = function captureCase(testCase: TestPlan['cases'][number]): TestPlan['cases'][number] {
        const { execution } = testCase;
        if (execution.kind !== 'body' || execution.bodyMode !== 'benchmark') {
            return testCase;
        }
        const calibration = readBenchmarkCalibrationBody(execution.body);
        if (calibration === null) {
            throw new RunCollectionError(
                'Benchmark does not expose calibration resource execution.',
                { cause: null },
                'measurement'
            );
        }
        return {
            ...testCase,
            resourceAttachments: readTestBodyResourceAttachments(calibration.resourceBody),
            execution: { ...execution, body: calibration.body, resourceBody: calibration.resourceBody }
        };
    };
    const [ first, ...rest ] = testPlan.cases;
    return { ...testPlan, cases: [ captureCase(first), ...rest.map(captureCase) ] };
}
