import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { table, suite, test } from '@overkill-dev/test';

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

const fixture = 'source/integration-tests/runtime/fixtures/placement.bench.test.ts';
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

const executionChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    result: Awaited<ReturnType<RunOrchestrator['bench']['run']>>,
    scenario: PlacementScenario
): CompositeAssertionReturn<'assert'> {
    const metadata = readBenchmarkRunMetadata(result.context.facts);
    if (metadata === null) {
        return check.defined(metadata);
    }
    return check.group([
        check.deepEqual(result.runnerErrors, []),
        check.equal(result.summary.passed, 2),
        check.false(Object.hasOwn(metadata, 'version')),
        check.equal(
            metadata.execution.workerCount,
            scenario.execution.processModel === 'worker-pool' ? scenario.expectedWorkers : null
        ),
        check.equal(metadata.placement?.maximumWorkers, scenario.expectedWorkers === 1 ? 1 : 7)
    ]);
};

const placementChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    directory: string,
    scenario: PlacementScenario
): Promise<CompositeAssertionReturn<'assert'>> {
    let observations = 0;
    const runner = placementRunner(scenario.busyPercent, function observed() {
        observations += 1;
    });
    const input = command(directory, scenario.title, scenario.execution);
    const listed = await runner.bench.list(input, { timing: null });
    return check.group([
        check.equal(observations, 0),
        check.equal(listed.facts.benchmarkPlacement?.maximumWorkers, 1),
        check.equal(listed.facts.cases.length, 2),
        executionChecks(check.annotated('execution'), await runner.bench.run(input, { timing: null }), scenario),
        check.equal(observations, 1)
    ]);
};

const assertPlacement = defineCompositeAssertion({
    name: 'benchmark placement',
    async assert(check, scenario: PlacementScenario) {
        await mkdir('target', { recursive: true });
        const directory = await mkdtemp('target/benchmark-placement-');
        try {
            return await placementChecks(check, directory, scenario);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
});

const parallelExecutions: readonly Extract<BenchmarkExecution, { readonly processModel: 'worker-pool'; }>[] = [
    workerExecution,
    { ...workerExecution, dispatchPolicy: 'static-assignment' },
    { ...workerExecution, workerLifecycle: 'fresh-worker-per-unit' },
    { ...workerExecution, hostProcess: { kind: 'child', nodeArguments: [] } }
];

export const testNode = suite('adaptive benchmark worker execution', [
    table({
        title: 'overlaps benchmark size measurements',
        cases: parallelExecutions.map(function parallelExecution(execution) {
            const shape = `${execution.workerLifecycle}/${execution.dispatchPolicy}/${execution.hostProcess.kind}`;
            return { execution, shape };
        }),
        caseTitle({ shape }) {
            return [ shape ].map(String).join(', ');
        },
        async test(scope) {
            const { execution } = scope.parameters;

            await scope.assert(assertPlacement, {
                execution,
                title: 'parallel sizes',
                busyPercent: 0,
                expectedWorkers: 2
            });
            return scope.assert.collect();
        }
    }),
    test('serializes size measurements under CPU saturation', async function (scope) {
        await scope.assert(assertPlacement, {
            execution: workerExecution,
            title: 'serial sizes',
            busyPercent: 100,
            expectedWorkers: 1
        });
        return scope.assert.collect();
    }),
    test('serializes sensitive measurements on an idle host', async function (scope) {
        await scope.assert(assertPlacement, {
            execution: workerExecution,
            title: 'sensitive work',
            busyPercent: 0,
            expectedWorkers: 1
        });
        return scope.assert.collect();
    }),
    test('preserves supervised serialization on an idle host', async function (scope) {
        await scope.assert(assertPlacement, {
            execution: { processModel: 'supervised-process', scheduling: 'serial', maxConcurrency: 1 },
            title: 'serial sizes',
            busyPercent: 0,
            expectedWorkers: 1
        });
        return scope.assert.collect();
    })
]);
