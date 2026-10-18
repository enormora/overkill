import {
    createRoot,
    createTestPlan,
    createSkippedTestCase,
    createThrowingTestCase,
    createBenchmarkTestCase,
    type TestPlanCase
} from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { builderBodyForAttempt, createBenchmarkAttempt } from '../engine/case-body-execution.ts';
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

export const testNode = suite('benchmark execution contracts', [
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
                return builderBodyForAttempt(testCase, attempt);
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
            return builderBodyForAttempt(unselected, attempt);
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
            attempt
        );
        await scope.assert.rejects(async function () {
            return body(scope);
        }, { message: 'Selected workload is absent from the benchmark definition.' });
        scope.assert.equal(attempt.result(), null);
        return scope.assert.collect();
    })
]);
