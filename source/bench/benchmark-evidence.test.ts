import {
    createRoot,
    createTestPlan,
    execute,
    type RunResult,
    type TestCase
} from '../packages/engine/engine.entry-point.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { runResultSchema } from '../run/run-result-schema.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { benchmark } from './benchmark-authoring.ts';
import { wallClockMeasurement } from './measurement-strategy.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';
import { unavailableMetric } from './metric-reading.ts';
import { workload, workloadIdentity } from './workload.ts';

async function runBenchmark(node: TestCase): Promise<RunResult> {
    return await execute(
        createTestPlan(createRoot({ title: 'root', children: [ node ], annotations: {}, controls: {} }))
    );
}

export const testNode = suite('benchmark evidence contracts', [
    test('workload identities retain values beyond diagnostic serialization limits', function (scope) {
        const values = Array.from({ length: 101 }, function () {
            return 1;
        });
        const first = workload('large', { values, text: 'a'.repeat(9000) });
        const changedArray = workload('large', { values: values.with(100, 2), text: 'a'.repeat(9000) });
        const changedText = workload('large', { values, text: `${'a'.repeat(9000)}b` });
        scope.assert.notEqual(workloadIdentity(first).params.values, workloadIdentity(changedArray).params.values);
        scope.assert.notEqual(workloadIdentity(first).params.text, workloadIdentity(changedText).params.text);
        values[0] = 3;
        scope.assert.equal(first.parameters.values[0], 1);
        scope.assert.false(Reflect.set(first.parameters.values, '0', 4));
        return scope.assert.collect();
    }),
    test('keeps established failures when another target remains unresolved', async function (scope) {
        let index = 0;
        const result = await runBenchmark(benchmark('mixed targets', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                const measured = sample.measure(function () {
                    index += 1;
                    return index;
                });
                return { failed: 2, overlapping: measured.value % 2 };
            },
            diagnosticMetrics: [],
            budgets: { one: { failed: { maximum: 1 }, overlapping: { maximum: 0.5 } } }
        }, { annotations: {}, controls: {}, sampling: { ...defaultSamplingPolicy, maximumSamples: 128 } }));
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
        const measurement = result.perTest[0]?.benchmark;
        scope.assert.equal(measurement?.status, 'incomplete');
        scope.assert.deepEqual(
            measurement?.budgets.map(function (budget) {
                return budget.decision;
            }) ?? [],
            [
                'fail',
                'undecided'
            ]
        );
        return scope.assert.collect();
    }),
    test('diagnostics do not extend finite-run extrema sampling', async function (scope) {
        let index = 0;
        const result = await runBenchmark(benchmark('diagnostics', {
            kind: 'memory',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    index += 1;
                    return index;
                });
                return { size: 4, noise: index % 2 };
            },
            diagnosticMetrics: [ 'noise' ],
            budgets: { one: { size: { maximum: 4, statistic: { kind: 'observed-maximum' } } } }
        }, { annotations: {}, controls: {}, sampling: { ...defaultSamplingPolicy, minimumSamples: 2 } }));
        scope.assert.equal(index, 34);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.perTest[0]?.benchmark?.rawSamples.status, 'omitted');
        return scope.assert.collect();
    }),
    test('retains the confirmed prefix after invalid metric data', async function (scope) {
        let index = 0;
        const result = await runBenchmark(benchmark('prefix', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    index += 1;
                    return index;
                });
                return { value: index === 161 ? Number.NaN : index % 2 };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 0.5 } } }
        }));
        scope.assert.equal(result.summary.inconclusive, 1);
        const measurement = result.perTest[0]?.benchmark;
        scope.assert.equal(measurement?.samples, 128);
        scope.assert.equal(measurement?.metrics.value?.count, 128);
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
        return scope.assert.collect();
    }),
    test('fails unavailable budget metrics with an explicit reason', async function (scope) {
        const result = await runBenchmark(benchmark('unsupported', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    return 1;
                });
                return {
                    counter: unavailableMetric('Unsupported counter.', {
                        collector: 'custom-counter',
                        unit: 'count',
                        scope: 'process'
                    })
                };
            },
            diagnosticMetrics: [],
            budgets: { one: { counter: { maximum: 1 } } }
        }));
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(result.perTest[0]?.benchmark?.metrics.counter?.unavailableReasons ?? [], [
            'Unsupported counter.'
        ]);
        scope.assert.equal(result.runnerErrors.length, 0);
        return scope.assert.collect();
    }),
    test('decodes historical results with absent measurement fields', function (scope) {
        const result = runResultFactory.build({ perTest: [ { verdict: 'pass', outcome: { kind: 'pass' } } ] });
        const historical = {
            ...result,
            perTest: result.perTest.map(function removeMeasurement(entry) {
                const { benchmark: _benchmark, ...ordinary } = entry;
                return {
                    ...ordinary,
                    attempts: ordinary.attempts.map(function removeAttemptMeasurement(attempt) {
                        const { benchmark: _attemptBenchmark, ...ordinaryAttempt } = attempt;
                        return ordinaryAttempt;
                    })
                };
            })
        };
        const decoded = runResultSchema.parse(historical);
        scope.assert.equal(decoded.perTest[0]?.benchmark, null);
        scope.assert.equal(decoded.perTest[0]?.attempts[0].benchmark, null);
        return scope.assert.collect();
    })
]);
