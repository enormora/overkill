import { executeEngineCase } from '../test-support/create-test-engine.ts';
import { type TestNode, suite, test } from '@overkill-dev/test';

import { processMeasurement } from '../packages/bench/bench.entry-point.ts';
import { benchmarkDefinitionSchema } from '../run/benchmark-definition-schema.ts';
import {
    type TestPlanCase,
    createRoot,
    createTestPlan,
    createSkippedTestCase,
    createThrowingTestCase,
    createBenchmarkTestCase
} from '../packages/engine/engine.entry-point.ts';
import { builderBodyForAttempt, createBenchmarkAttempt } from '../engine/benchmark-attempt.ts';
import { benchmark } from './benchmark-authoring.ts';
import { wallClockMeasurement } from './measurement-strategy.ts';
import { workload } from './workload.ts';

const metadata = {
    annotations: {},
    controls: {},
    title: 'case',
    definitionLocations: [ { kind: 'unknown' } ]
} as const;

function benchmarkCase(): TestPlanCase {
    const node = benchmark('measured', {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: wallClockMeasurement(),
        measure({ sample }) {
            return {
                value: sample
                    .measure(function () {
                        return 1;
                    })
                    .value
            };
        },
        diagnosticMetrics: [],
        budgets: { one: { value: { maximum: 2 } } }
    });
    return createTestPlan(createRoot({ ...metadata, children: [ node ] })).cases[0];
}

export const testNode: TestNode = suite('benchmark execution contracts', [
    test('accepts process strategies in serialized benchmark definitions', function (scope) {
        const result = benchmarkDefinitionSchema.safeParse({
            kind: 'startup',
            lifecycle: null,
            workloads: [],
            diagnostics: [],
            budgets: {},
            measurement: processMeasurement({ instrumentation: 'node' }),
            policy: {
                confidenceLevel: 0.95,
                relativePrecision: 0.1,
                absolutePrecision: {},
                minimumSamples: 2,
                maximumSamples: 2
            }
        });
        scope.assert.true(result.success);
        return scope.assert.collect();
    }),
    test('rejects missing workload metadata at the engine boundary', function (scope) {
        const selected = benchmarkCase();
        const { execution } = selected;
        if (execution.kind !== 'body' || execution.bodyMode !== 'benchmark') {
            throw new Error('Expected benchmark execution.');
        }
        const options = { ...metadata, ...execution };
        scope.assert.throws(function () {
            return createBenchmarkTestCase({ ...options, workloads: [] });
        }, { message: 'Benchmark must declare at least one workload.' });
        scope.assert.throws(function () {
            const node = createBenchmarkTestCase({
                ...options,
                definition: { ...execution.definition, workloads: [] }
            });
            return createTestPlan(createRoot({ ...metadata, children: [ node ] }));
        }, { message: 'Benchmark workload is absent from its definition.' });
        return scope.assert.collect();
    }),
    test('rejects authoring without a measurement callback', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(benchmark, undefined, [ 'missing', {} ]);
        }, { message: 'Benchmark requires a measure function.' });
        return scope.assert.collect();
    }),
    test('rejects skipped and throwing cases as builder bodies', function (scope) {
        const plan = createTestPlan(createRoot({
            ...metadata,
            children: [
                createSkippedTestCase({ ...metadata, title: 'skipped', reason: 'unused' }),
                createThrowingTestCase({
                    ...metadata,
                    body() {
                        return undefined;
                    }
                })
            ]
        }));
        for (const testCase of plan.cases) {
            const attempt = createBenchmarkAttempt(testCase, async function () {
                return undefined;
            }, null);
            scope.assert.throws(function () {
                return builderBodyForAttempt(testCase, attempt, { index: 0 });
            }, { message: 'Test case does not have a builder body.' });
        }
        return scope.assert.collect();
    }),
    test('requires workload selection before executing a benchmark', function (scope) {
        const selected = benchmarkCase();
        const unselected = { ...selected, workId: { ...selected.workId, workload: null } };
        const attempt = createBenchmarkAttempt(unselected, async function () {
            return undefined;
        }, null);
        scope.assert.throws(function () {
            return builderBodyForAttempt(unselected, attempt, { index: 0 });
        }, { message: 'Benchmark execution requires a selected workload.' });
        return scope.assert.collect();
    }),
    test('rejects a workload absent from its authored definition', async function (scope) {
        const selected = benchmarkCase();
        const attempt = createBenchmarkAttempt(selected, async function () {
            return undefined;
        }, null);
        const body = builderBodyForAttempt(
            {
                ...selected,
                workId: { ...selected.workId, workload: { name: 'missing', params: {} } }
            },
            attempt,
            { index: 0 }
        );
        const result = await executeEngineCase(body);
        scope.assert.partialDeepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
            kind: 'fail',
            failures: [ {
                kind: 'body-error',
                error: { message: 'Selected workload is absent from the benchmark definition.' }
            } ]
        });
        scope.assert.equal(attempt.result(), null);
        return scope.assert.collect();
    })
]);
