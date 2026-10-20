import { isDeepStrictEqual } from 'node:util';
import type { RunResult } from '../../engine/run-result.ts';
import { normalizationCommand, normalizationReferences } from '../../test-support/benchmark-normalization-fixture.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator, type RunCommand } from '../../packages/run/run.entry-point.ts';
import { createBenchmarkHtmlReport } from '../../reporters/benchmark-html-model.ts';
import { runResultSchema } from '../../run/run-result-schema.ts';
import { runIfMain } from '../direct-launcher.test.ts';
import { testNode as baselineTests } from './normalization-baseline.test.ts';

function assertChartScales(scope: TestScope, result: RunResult): void {
    scope.assert.true(
        isDeepStrictEqual(runResultSchema.parse(result).perTest[0]?.benchmark, result.perTest[0]?.benchmark)
    );
    const { groups } = createBenchmarkHtmlReport(result).charts;
    scope.assert.equal(groups.length, 2);
    scope.assert.true(groups.some(function rawGroup(group) {
        return group.name.includes('raw)');
    }));
    scope.assert.true(groups.some(function normalizedGroup(group) {
        return group.name.includes('normalized /');
    }));
}
function assertNormalizedResult(scope: TestScope, result: RunResult): void {
    const measured = result.perTest[0]?.benchmark;
    scope.require.defined(measured);
    scope.assert.equal(measured.metrics.value?.median, 100);
    const { normalization } = measured;
    scope.require.defined(normalization);
    const metric = normalization.metrics.value;
    scope.require.defined(metric);
    scope.assert.equal(metric.summary?.median, 50);
    scope.assert.equal(measured.budgets[0]?.estimate, 0.5);
    assertChartScales(scope, result);
}
function assertAutomaticResult(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.status, 'passed');
    scope.assert.deepEqual(result.runnerErrors, []);
    const measured = result.perTest[0]?.benchmark;
    scope.require.defined(measured);
    const { normalization } = measured;
    scope.require.defined(normalization);
    scope.assert.equal(measured.budgets[0]?.estimate, 0.5);
    scope.assert.equal(normalization.metrics.value?.source, 'canonical');
}
async function captureFixedReference(
    scope: TestScope,
    command: RunCommand
): Promise<void> {
    const store = await normalizationReferences(command);
    const capture = await orchestrator.bench.calibrate(command, { timing: null });
    scope.assert.deepEqual(capture.result.runnerErrors, []);
    scope.assert.equal(capture.result.status, 'passed');
    const [ reference ] = await store.list();
    scope.require.defined(reference);
    await store.write('bench', [ {
        ...reference.snapshot,
        samples: reference.snapshot.samples.map(function fasterReference() {
            return 100;
        })
    } ], function owners() {
        return reference.owners;
    });
}
async function runNormalizedBenchmark(
    scope: TestScope,
    command: RunCommand
): Promise<RunResult> {
    const result = await orchestrator.bench.run(command, { timing: null });
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.status, 'passed');
    return result;
}
export const testNode = suite('benchmark normalization process boundaries', [
    baselineTests,
    ...([ 'supervised-process', 'reuse', 'fresh-worker-per-unit' ] as const).map(function boundaryTest(boundary) {
        return test(`captures and normalizes through ${boundary}`, async function (scope: TestScope) {
            const command = await normalizationCommand(scope, boundary, 'normalized metric');
            const store = await normalizationReferences(command);
            const listed = await orchestrator.bench.list(command, { timing: null });
            scope.assert.equal(listed.facts.benchmarkNormalization, null);
            scope.assert.deepEqual(await store.list(), []);
            await captureFixedReference(scope, command);
            const result = await runNormalizedBenchmark(scope, command);
            assertNormalizedResult(scope, result);
            return scope.assert.collect();
        });
    }),
    test(
        'captures without acquiring unrelated fixtures or running benchmark bodies',
        async function (scope: TestScope) {
            const command = await normalizationCommand(scope, 'reuse', 'capture skips benchmark fixtures');
            const result = await orchestrator.bench.calibrate(command, { timing: null });
            scope.assert.deepEqual(result.result.runnerErrors, []);
            scope.assert.equal(result.result.status, 'passed');
            const store = await normalizationReferences(command);
            const references = await store.list();
            scope.assert.equal(references.length, 1);
            return scope.assert.collect();
        }
    ),
    test('keeps constructor metrics raw without a scaling rule', async function (scope: TestScope) {
        const command = await normalizationCommand(scope, 'reuse', 'mixed normalized and raw metrics');
        await captureFixedReference(scope, command);
        const result = await runNormalizedBenchmark(scope, command);
        const measured = result.perTest[0]?.benchmark;
        scope.require.defined(measured);
        scope.assert.deepEqual(
            measured.budgets.map(function estimate(budget) {
                return budget.estimate;
            }),
            [ 0.5, 100 ]
        );
        scope.assert.equal(createBenchmarkHtmlReport(result).charts.groups.length, 3);
        return scope.assert.collect();
    }),
    test('normalizes automatically without captured references', async function (scope: TestScope) {
        const command = await normalizationCommand(scope, 'supervised-process', 'normalized metric');
        const result = await orchestrator.bench.run(command, { timing: null });
        assertAutomaticResult(scope, result);
        const store = await normalizationReferences(command);
        scope.assert.deepEqual(await store.list(), []);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
