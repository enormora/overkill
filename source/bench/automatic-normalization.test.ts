import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';
import { runWithAttachmentContext } from '../attachments/attachment-context.ts';
import {
    benchmark,
    wallClockMeasurement,
    moduleMeasurement,
    timelineMeasurement,
    workload
} from '../packages/bench/bench.entry-point.ts';
import { options, measuredMachine, firstBenchmark, executeMachine } from '../test-support/normalized-machine.ts';
import { type TestCase, createRoot, createTestPlan, execute } from '../packages/engine/engine.entry-point.ts';
import { testNode as collectionPolicy } from './garbage-collection-policy.test.ts';

function durationBenchmark(garbageCollection: 'after-sample' | 'off'): TestCase {
    return benchmark('automatic duration', {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: wallClockMeasurement(),
        measure({ sample }) {
            const measured = sample.measure(function () {
                return 1;
            });
            return { durationMicroseconds: measured.metrics.durationMicroseconds };
        },
        diagnosticMetrics: [],
        budgets: { one: { durationMicroseconds: { maximum: 1000, statistic: { kind: 'observed-maximum' } } } }
    }, { ...options, lifecycle: { ...options.lifecycle, garbageCollection } });
}
async function moduleImportBenchmark(scope: TestScope): Promise<TestCase> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-normalized-import-'));
    scope.cleanup(async function removeModule() {
        await rm(directory, { recursive: true, force: true });
    });
    const filename = join(directory, 'entry.cjs');
    await writeFile(filename, 'module.exports = () => { throw new Error("Export must not be called."); };');
    return benchmark('automatic cold import', {
        kind: 'startup',
        workloads: [ workload('one', {}) ],
        measurement: timelineMeasurement(moduleMeasurement(), { maximumEvents: 128 }),
        async measure({ sample }) {
            const imported = await sample.importModule({
                url: pathToFileURL(filename),
                cwd: process.cwd(),
                env: null,
                nodeArguments: []
            });
            return { durationMicroseconds: imported.metrics.durationMicroseconds };
        },
        diagnosticMetrics: [],
        budgets: { one: { durationMicroseconds: { maximum: 5_000_000, statistic: { kind: 'observed-maximum' } } } }
    }, {
        ...options,
        lifecycle: { ...options.lifecycle, warmupSamples: 1 },
        sampling: { ...options.sampling, minimumSamples: 2, maximumSamples: 2 }
    });
}

export const testNode = authoredSuite('automatic benchmark normalization', [
    collectionPolicy,
    test(
        'normalizes cold imports while retaining their own process provenance and trace',
        async function (scope: TestScope) {
            const node = await moduleImportBenchmark(scope);
            const result = await runWithAttachmentContext(null, async function () {
                return await execute(createTestPlan(createRoot({
                    title: 'cold imports',
                    annotations: {},
                    controls: {},
                    children: [ node ]
                })));
            });
            const measured = firstBenchmark(result);
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(measured.normalization?.metrics.durationMicroseconds?.source, 'canonical');
            scope.assert.equal(measured.metrics.durationMicroseconds?.provenance.collector, 'module-import-v1');
            scope.assert.equal(measured.lifecycle?.warmup.samples, 1);
            scope.assert.equal(measured.timeline?.status, 'omitted');
            return scope.assert.collect();
        }
    ),
    test(
        'executes automatic CPU normalization directly without runner configuration',
        async function (scope: TestScope) {
            const node = durationBenchmark('off');
            const result = await runWithAttachmentContext(null, async function () {
                return await execute(
                    createTestPlan(
                        createRoot({ title: 'automatic', annotations: {}, controls: {}, children: [ node ] })
                    )
                );
            });
            const measured = firstBenchmark(result);
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(measured.normalization?.metrics.durationMicroseconds?.source, 'canonical');
            scope.assert.equal(measured.normalization?.calibrations[0]?.identity.workload.name, 'integer-mix');
            return scope.assert.collect();
        }
    ),
    test(
        'preserves existing GC capabilities when adding an automatic calibration context',
        async function (scope: TestScope) {
            let collections = 0;
            const result = await executeMachine(durationBenchmark('after-sample'), {
                normalization: null,
                profileGarbageCollection: 'off',
                garbageCollection: {
                    kind: 'available',
                    collect() {
                        collections += 1;
                    }
                }
            });
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(collections, 128);
            scope.assert.equal(
                firstBenchmark(result).normalization?.metrics.durationMicroseconds?.source,
                'canonical'
            );
            return scope.assert.collect();
        }
    ),

    test(
        'uses one cached non-CPU calibration for multiple metrics and needs no captured files',
        async function (scope: TestScope) {
            let samples = 0;
            const result = await measuredMachine(100, 'fast-mac', 1000, function () {
                samples += 1;
            });
            const measured = firstBenchmark(result);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(samples, 128);
            scope.assert.equal(measured.normalization?.metrics.value?.source, 'canonical');
            scope.assert.equal(measured.normalization?.calibrations.length, 1);
            scope.assert.equal(measured.budgets[0]?.estimate, 10);
            scope.assert.equal(measured.metrics.value?.median, 1000);
            return scope.assert.collect();
        }
    ),
    test('shares proportional, inverse and raw budgets across different hardware', async function (scope: TestScope) {
        const fast = await measuredMachine(100, 'fast-mac', 1000, function () {
            return undefined;
        });
        const slow = await measuredMachine(400, 'slow-arm-runner', 4000, function () {
            return undefined;
        });
        const first = firstBenchmark(fast);
        const second = firstBenchmark(slow);
        scope.assert.deepEqual([ fast.status, slow.status ], [ 'passed', 'passed' ]);
        scope.assert.deepEqual(first.budgets, second.budgets);
        scope.assert.equal(second.budgets[0]?.estimate, 10);
        scope.assert.equal(second.normalization?.metrics.value?.budgetReference.machineClass, 'reference-workload');
        scope.assert.equal(second.metrics.value?.median, 4000);
        return scope.assert.collect();
    }),
    test('still detects a real regression on the slower machine', async function (scope: TestScope) {
        const result = await measuredMachine(400, 'slow-arm-runner', 6000, function () {
            return undefined;
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(firstBenchmark(result).budgets[0]?.decision, 'fail');
        scope.assert.equal(firstBenchmark(result).budgets[0]?.estimate, 15);
        return scope.assert.collect();
    })
]);
