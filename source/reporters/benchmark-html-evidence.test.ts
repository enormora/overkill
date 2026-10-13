import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { runResultSchema } from '../run/run-result-schema.ts';
import { readBenchmarkSamples } from '../bench/benchmark-sample-report.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';

export const testNode = suite('benchmark HTML retained evidence', [
    test('uses stable artifact references and rejects another attempt', function (scope: TestScope) {
        const result = benchmarkHtmlFixture('latency');
        const original = result.perTest[0];
        scope.require.defined(original);
        const samples = readBenchmarkSamples(result, original);
        scope.assert.deepEqual(samples, { kind: 'available', partial: false, metrics: { latency: [ 1, 2, 3, 4 ] } });
        const later = { ...original, attempts: [ { ...original.attempts[0], attempt: { index: 1 } } ] } as const;
        scope.assert.throws(function () {
            return readBenchmarkSamples(result, later);
        }, { message: 'Raw sample artifact belongs to another workload, runtime, case, or attempt.' });
        return scope.assert.collect();
    }),
    test('reads samples from a saved result without rerunning benchmarks', function (scope: TestScope) {
        const serialized = JSON.stringify(benchmarkHtmlFixture('saved'));
        const restored = runResultSchema.parse(JSON.parse(serialized));
        const original = restored.perTest[0];
        scope.require.defined(original);
        scope.assert.deepEqual(readBenchmarkSamples(restored, original), {
            kind: 'available',
            partial: false,
            metrics: { latency: [ 1, 2, 3, 4 ] }
        });
        return scope.assert.collect();
    }),
    test('keeps summary and budget evidence when sample artifacts are absent', function (scope: TestScope) {
        const result = benchmarkHtmlFixture('absent samples');
        const report = createBenchmarkHtmlReport({ ...result, artifacts: [] });
        const row = report.charts.groups[0]?.rows[0];
        scope.require.defined(row);
        scope.assert.equal(row.summary.mean, 2.5);
        scope.assert.equal(row.budgets[0]?.decision, 'pass');
        scope.assert.deepEqual(row.histogram, []);
        scope.assert.deepEqual(row.box, []);
        scope.assert.includes(row.sampleNote, 'unavailable');
        return scope.assert.collect();
    }),
    test('rejects sample evidence owned by another workload', function (scope: TestScope) {
        const result = benchmarkHtmlFixture('identity');
        const original = result.perTest[0];
        scope.require.defined(original);
        const changed = { ...original, workId: { ...original.workId, workload: { name: 'large', params: {} } } };
        scope.assert.throws(function () {
            readBenchmarkSamples(result, changed);
        }, {
            message: 'Raw sample artifact belongs to another workload, runtime, case, or attempt.'
        });
        return scope.assert.collect();
    })
]);
