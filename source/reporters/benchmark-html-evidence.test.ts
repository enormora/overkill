import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { runResultSchema } from '../run/run-result-schema.ts';
import { readBenchmarkSamples } from '../bench/benchmark-sample-report.ts';
import { createProcessEvidenceReader, processEvidenceMediaType } from '../bench/process-evidence-query.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { unavailableMetric, availableMetric } from '../bench/metric-reading.ts';
import type { RunResult, PerTestResult } from '../engine/run-result.ts';
import { createBenchmarkHtmlReport } from './benchmark-html-model.ts';
import { formatBenchmarkWorkload } from './benchmark-html-metrics.ts';

type MeasuredTest = PerTestResult & { readonly benchmark: NonNullable<PerTestResult['benchmark']>; };
type RetainedFixture = {
    readonly result: RunResult;
    readonly measured: MeasuredTest;
    readonly artifact: RuntimeAttachmentArtifact;
    readonly provenance: MeasuredTest['benchmark']['metrics'][string]['provenance'];
};
function retainedAttachment(result: RunResult): RuntimeAttachmentArtifact {
    const artifact = result.artifacts[0];
    if (artifact?.payload.kind !== 'runtime-attachment') {
        throw new Error('Expected sample attachment.');
    }
    return artifact as RuntimeAttachmentArtifact;
}
function retainedFixture(scope: TestScope): RetainedFixture {
    const result = benchmarkHtmlFixture('retention');
    const testResult = result.perTest[0];
    scope.require.defined(testResult);
    const { benchmark } = testResult;
    scope.require.defined(benchmark);
    const provenance = benchmark.metrics.latency?.provenance;
    scope.require.defined(provenance);
    return { result, measured: { ...testResult, benchmark }, artifact: retainedAttachment(result), provenance };
}

function replaceSamples(
    artifact: RuntimeAttachmentArtifact,
    content: RuntimeAttachmentArtifact['payload']['content']
): RuntimeAttachmentArtifact {
    return { ...artifact, payload: { ...artifact.payload, content } };
}

export const testNode = suite('benchmark HTML retained evidence', [
    test('keeps indexed process evidence scoped to its owning work', function (scope: TestScope) {
        const { result, measured, artifact } = retainedFixture(scope);
        const owned = { ...artifact, payload: { ...artifact.payload, mediaType: processEvidenceMediaType } };
        const workload = { name: 'large', params: {} };
        const foreign = { ...owned, id: { ...owned.id, workload } };
        const readProcesses = createProcessEvidenceReader({ ...result, artifacts: [ artifact, owned, foreign ] });
        scope.assert.deepEqual(readProcesses(measured.workId), [ owned ]);
        scope.assert.deepEqual(readProcesses({ ...measured.workId, workload }), [ foreign ]);
        scope.assert.deepEqual(
            readProcesses({ ...measured.workId, case: { ...measured.id, title: 'another case' } }),
            []
        );
        scope.assert.deepEqual(
            readProcesses({
                ...measured.workId,
                runtimes: [ { name: 'node', variantId: null, dimensions: {}, scenarios: {} } ]
            }),
            []
        );
        return scope.assert.collect();
    }),
    test('reads unavailable samples without requiring a matching metric summary', function (scope: TestScope) {
        const { result, measured, artifact, provenance } = retainedFixture(scope);
        const samples = replaceSamples(artifact, {
            kind: 'json',
            byteLength: 0,
            value: { unrecorded: [ unavailableMetric('Collector unavailable.', provenance) ] }
        });
        scope.assert.deepEqual(readBenchmarkSamples({ ...result, artifacts: [ samples ] }, measured), {
            kind: 'available',
            partial: false,
            metrics: { unrecorded: [] }
        });
        return scope.assert.collect();
    }),
    test('retains the first artifact when references have duplicate identities', function (scope: TestScope) {
        const { result, measured, artifact } = retainedFixture(scope);
        const duplicate = replaceSamples(artifact, { kind: 'json', byteLength: 0, value: {} });
        scope.assert.deepEqual(
            readBenchmarkSamples({ ...result, artifacts: [ artifact, duplicate ] }, measured),
            readBenchmarkSamples(result, measured)
        );
        return scope.assert.collect();
    }),
    test('explains omitted and unrecorded samples', function (scope: TestScope) {
        const { result, measured } = retainedFixture(scope);
        scope.assert.deepEqual(readBenchmarkSamples(result, { ...measured, benchmark: null }), {
            kind: 'unavailable',
            reason: 'No raw samples recorded.'
        });
        for (const reason of [ null, 'Retention disabled.' ]) {
            scope.assert.deepEqual(
                readBenchmarkSamples(result, {
                    ...measured,
                    benchmark: { ...measured.benchmark, rawSamples: { status: 'omitted', reference: null, reason } }
                }),
                { kind: 'unavailable', reason: reason ?? 'No raw samples recorded.' }
            );
        }
        return scope.assert.collect();
    }),
    test('labels partial distributions and excludes unavailable readings', function (scope: TestScope) {
        const { result, measured, artifact, provenance } = retainedFixture(scope);
        const sampleArtifact = replaceSamples(artifact, {
            kind: 'json',
            byteLength: 0,
            value: {
                latency: [ availableMetric(7, provenance), unavailableMetric('Collector unavailable.', provenance) ]
            }
        });
        const changed = {
            ...measured,
            benchmark: {
                ...measured.benchmark,
                rawSamples: { ...measured.benchmark.rawSamples, status: 'truncated' as const }
            }
        };
        const partial = { ...result, artifacts: [ sampleArtifact ], perTest: [ changed ] };
        scope.assert.deepEqual(readBenchmarkSamples(partial, changed), {
            kind: 'available',
            partial: true,
            metrics: { latency: [ 7 ] }
        });
        const row = createBenchmarkHtmlReport(partial).charts.groups[0]?.rows[0];
        scope.require.defined(row);
        scope.assert.equal(row.sampleNote, 'Retained partial samples.');
        scope.assert.deepEqual(row.histogram, [ 1 ]);
        return scope.assert.collect();
    }),
    test('rejects changed metric provenance', function (scope: TestScope) {
        const { result, measured, artifact } = retainedFixture(scope);
        const sampleArtifact = replaceSamples(artifact, {
            kind: 'json',
            byteLength: 0,
            value: { latency: [ availableMetric(7, { collector: 'other', scope: 'custom', unit: 'seconds' }) ] }
        });
        scope.assert.throws(function () {
            readBenchmarkSamples({ ...result, artifacts: [ sampleArtifact ] }, measured);
        }, { message: 'Raw sample provenance differs from metric latency.' });
        return scope.assert.collect();
    }),
    test('explains non-JSON retention and rejects unrelated payloads', function (scope: TestScope) {
        const { result, measured, artifact } = retainedFixture(scope);
        const omitted = replaceSamples(artifact, { kind: 'omitted', reason: 'byte-limit', limit: 1 });
        scope.assert.deepEqual(readBenchmarkSamples({ ...result, artifacts: [ omitted ] }, measured), {
            kind: 'unavailable',
            reason: 'Raw sample content is not retained as JSON.'
        });
        const unrelated = { ...artifact, payload: { ...artifact.payload, name: 'other' } };
        scope.assert.throws(function () {
            readBenchmarkSamples({ ...result, artifacts: [ unrelated ] }, measured);
        }, { message: 'Raw sample reference does not identify benchmark samples.' });
        return scope.assert.collect();
    }),
    test('rejects run-scoped samples even when their reference matches', function (scope: TestScope) {
        const { result, measured, artifact } = retainedFixture(scope);
        const runArtifact = { ...artifact, id: { ...artifact.id, attempt: null, scope: { kind: 'run' as const } } };
        const changed = {
            ...measured,
            benchmark: {
                ...measured.benchmark,
                rawSamples: {
                    ...measured.benchmark.rawSamples,
                    reference: JSON.stringify(runArtifact.id)
                }
            }
        };
        scope.assert.throws(function () {
            readBenchmarkSamples({ ...result, artifacts: [ runArtifact ] }, changed);
        }, { message: 'Raw sample artifact belongs to another workload, runtime, case, or attempt.' });
        return scope.assert.collect();
    }),
    test('retains runtime dimensions and default workload labels', function (scope: TestScope) {
        const { measured } = retainedFixture(scope);
        scope.assert.equal(
            formatBenchmarkWorkload({
                workId: {
                    ...measured.workId,
                    workload: null,
                    runtimes: [ { name: 'database', variantId: null, dimensions: { engine: 'sqlite' }, scenarios: {} } ]
                }
            }),
            'default (database:default {"engine":"sqlite"})'
        );
        scope.assert.equal(
            formatBenchmarkWorkload({
                workId: {
                    ...measured.workId,
                    runtimes: [ { name: 'database', variantId: 'postgres', dimensions: {}, scenarios: {} } ]
                }
            }),
            'small (database:postgres {})'
        );
        return scope.assert.collect();
    }),
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
