import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import {
    normalizeConfig,
    type BenchmarkExecution,
    type RunCommand,
    type RunOrchestrator
} from '../../packages/run/run.entry-point.ts';
import { placementRunner } from '../../test-support/benchmark-placement-fixture.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { readBenchmarkRunMetadata } from '../../bench/benchmark-run-report.ts';

const fixture = 'source/integration-tests/run/fixtures/placement.bench.test.ts';
const workerExecution: BenchmarkExecution = {
    processModel: 'worker-pool',
    scheduling: 'serial',
    maxConcurrency: 1,
    maxWorkers: 2,
    workerLifecycle: 'reuse',
    workDistribution: { mode: 'case' },
    assignmentPolicy: 'case-count-balanced',
    dispatchPolicy: 'dynamic-lease',
    hedging: { mode: 'off' },
    hostProcess: { kind: 'direct' }
};

function command(directory: string, title: string, execution: BenchmarkExecution): RunCommand {
    const config = normalizeConfig({
        runtimeStateDir: directory,
        reporters: [ createLineReporter() ],
        profiles: { sizes: { testFamily: 'benchmark', files: { include: [ fixture ] } } }
    });
    const profile = config.profiles.sizes;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return {
        config: { ...config, profiles: { sizes: { ...profile, execution } } },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            profile: 'sizes',
            workers: execution.processModel === 'worker-pool' ? 4 : null,
            selection: { kind: 'filter', filter: { field: 'title', kind: 'equals', value: title } }
        })
    };
}

type PlacementScenario = {
    readonly execution: BenchmarkExecution;
    readonly title: string;
    readonly busyPercent: number;
    readonly expectedWorkers: number;
};

function assertExecution(
    scope: TestScope,
    result: Awaited<ReturnType<RunOrchestrator['bench']['run']>>,
    scenario: PlacementScenario
): void {
    const metadata = readBenchmarkRunMetadata(result);
    scope.require.defined(metadata);
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.passed, 2);
    scope.assert.equal(metadata.version, 4);
    scope.assert.equal(
        metadata.execution.workerCount,
        scenario.execution.processModel === 'worker-pool' ? scenario.expectedWorkers : null
    );
    scope.assert.equal(metadata.placement?.maximumWorkers, scenario.expectedWorkers === 1 ? 1 : 7);
}

async function observePlacement(scope: TestScope, directory: string, scenario: PlacementScenario): Promise<void> {
    let observations = 0;
    const runner = placementRunner(scenario.busyPercent, function observed() {
        observations += 1;
    });
    const input = command(directory, scenario.title, scenario.execution);
    const listed = await runner.bench.list(input, { timing: null });
    scope.assert.equal(observations, 0);
    scope.assert.equal(listed.facts.benchmarkPlacement?.maximumWorkers, 1);
    scope.assert.equal(listed.facts.cases.length, 2);
    assertExecution(scope, await runner.bench.run(input, { timing: null }), scenario);
    scope.assert.equal(observations, 1);
}

async function assertPlacement(scope: TestScope, scenario: PlacementScenario): Promise<void> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/benchmark-placement-');
    try {
        await observePlacement(scope, directory, scenario);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

const parallelExecutions: readonly Extract<BenchmarkExecution, { readonly processModel: 'worker-pool'; }>[] = [
    workerExecution,
    { ...workerExecution, dispatchPolicy: 'static-assignment' },
    { ...workerExecution, workerLifecycle: 'fresh-worker-per-unit' },
    { ...workerExecution, hostProcess: { kind: 'child', nodeArguments: [] } }
];

export const testNode = suite('adaptive benchmark worker execution', [
    ...parallelExecutions.map(function parallelExecution(execution) {
        const shape = `${execution.workerLifecycle}/${execution.dispatchPolicy}/${execution.hostProcess.kind}`;
        return test(
            `overlaps size measurements with ${shape}`,
            async function (scope) {
                await assertPlacement(scope, {
                    execution,
                    title: 'parallel sizes',
                    busyPercent: 0,
                    expectedWorkers: 2
                });
                return scope.assert.collect();
            }
        );
    }),
    test('serializes size measurements under CPU saturation', async function (scope) {
        await assertPlacement(scope, {
            execution: workerExecution,
            title: 'serial sizes',
            busyPercent: 100,
            expectedWorkers: 1
        });
        return scope.assert.collect();
    }),
    test('serializes sensitive measurements on an idle host', async function (scope) {
        await assertPlacement(scope, {
            execution: workerExecution,
            title: 'sensitive work',
            busyPercent: 0,
            expectedWorkers: 1
        });
        return scope.assert.collect();
    }),
    test('preserves supervised serialization on an idle host', async function (scope) {
        await assertPlacement(scope, {
            execution: { processModel: 'supervised-process', scheduling: 'serial', maxConcurrency: 1 },
            title: 'serial sizes',
            busyPercent: 0,
            expectedWorkers: 1
        });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
