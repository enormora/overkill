import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { completedHistoryRecord, historyWork } from '../test-support/history-record-fixture.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { canonicalJson } from '../canonical-identity.ts';
import type { BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import type { CompactRunRecord } from './run-record-types.ts';
import { compactRunRecord } from './compact-run-record.ts';
import { historyRecordSchema } from './history-record.ts';

const baseline = {
    version: 1,
    adapter: 'snapshot',
    profile: 'unit',
    subtype: 'content-snapshot',
    work: historyWork,
    comparisonContext: {},
    payload: { kind: 'text', text: 'private diagnostic payload' }
};
const change = { kind: 'create', baseline };
const calibration = { kind: 'comparable', machineClass: 'fixture', context: {}, metadata: {} };
const snapshot = {
    kind: 'snapshot',
    report: {
        changes: [ change ],
        warnings: [ 'fixture warning' ],
        writeOutcome: { kind: 'written', changes: [ change ] }
    }
};

function compactComparisons(reports: readonly unknown[]): CompactRunRecord {
    const record = completedHistoryRecord('comparison');
    return compactRunRecord(historyRecordSchema.parse({
        ...record,
        result: { ...record.result, baselineReports: reports }
    }));
}

function benchmarkEvidence(scope: TestScope): BenchmarkExecutionResult {
    const benchmark = benchmarkHtmlFixture('compaction').perTest[0]?.benchmark;
    scope.require.defined(benchmark);
    return {
        ...benchmark,
        timeline: {
            version: 1,
            events: 1,
            omitted: 0,
            status: 'recorded',
            reference: 'private-timeline',
            reason: null
        },
        lifecycle: {
            policy: { warmupSamples: 1, garbageCollection: 'off', cooldown: { mode: 'off' } },
            garbageCollection: { mode: 'off' },
            cleanup: { callbacks: 0, failures: 0 },
            cooldown: { mode: 'off' },
            warmup: {
                samples: 1,
                metrics: benchmark.metrics,
                rawSamples: { status: 'recorded', reference: 'private-warmup', reason: null }
            },
            measurement: {
                version: 1,
                omitted: 2,
                identity: {
                    target: {
                        semantics: {},
                        name: 'node',
                        version: '26',
                        scope: 'executing-runtime',
                        clock: 'monotonic'
                    },
                    collectors: []
                },
                invocations: [ {
                    invocation: {
                        execution: 'private-invocation',
                        work: historyWork,
                        attempt: { index: 0 },
                        phase: 'measured',
                        index: 0
                    },
                    target: {
                        semantics: {},
                        name: 'node',
                        version: '26',
                        scope: 'executing-runtime',
                        clock: 'monotonic',
                        instance: 'private-target',
                        document: null
                    },
                    collectors: [],
                    status: 'complete',
                    errors: [],
                    durationMicroseconds: 1,
                    lifecycleMicroseconds: 2
                } ]
            }
        }
    };
}

export const testNode = suite('compact run evidence', [
    test('preserves lifecycle summaries when measurement evidence is absent', function (scope: TestScope) {
        const original = completedHistoryRecord('unmeasured');
        const benchmark = benchmarkEvidence(scope);
        scope.require.defined(benchmark.lifecycle);
        const record = compactRunRecord({
            ...original,
            result: {
                ...original.result,
                perTest: [ {
                    benchmark: { ...benchmark, lifecycle: { ...benchmark.lifecycle, measurement: null } },
                    workId: historyWork,
                    verdict: 'pass',
                    durationMicroseconds: 10
                } ]
            }
        });
        scope.require.defined(record.result);
        const observed = record.result.perTest[0]?.benchmark;
        scope.require.defined(observed);
        scope.assert.partialDeepEqual(observed, {
            lifecycle: { measurement: null, warmup: { samples: 1 } }
        });
        scope.assert.equal(canonicalJson(compactRunRecord(record)), canonicalJson(record));
        return scope.assert.collect();
    }),
    test(
        'retains benchmark summaries without measurement traces or attachment references',
        function (scope: TestScope) {
            const original = completedHistoryRecord('benchmark');
            const benchmark = benchmarkEvidence(scope);
            const record = compactRunRecord({
                ...original,
                result: {
                    ...original.result,
                    perTest: [ { benchmark, workId: historyWork, verdict: 'pass', durationMicroseconds: 10 } ]
                }
            });
            const observed = record.result?.perTest[0]?.benchmark;
            scope.require.defined(observed);
            scope.assert.deepEqual(observed.metrics, benchmark.metrics);
            scope.assert.partialDeepEqual(observed, {
                timeline: null,
                rawSamples: { status: 'omitted', reference: null },
                lifecycle: {
                    garbageCollection: { mode: 'off' },
                    warmup: { samples: 1, rawSamples: { status: 'omitted', reference: null } },
                    measurement: { invocations: [], omitted: 3 }
                }
            });
            scope.assert.equal(JSON.stringify(record).includes('private-'), false);
            scope.assert.equal(canonicalJson(compactRunRecord(record)), canonicalJson(record));
            return scope.assert.collect();
        }
    ),
    test('retains snapshot outcomes while dropping comparison payloads', function (scope: TestScope) {
        const record = compactComparisons([ snapshot ]);
        scope.require.defined(record.result);
        scope.assert.deepEqual(record.result.baselineReports, [ {
            kind: 'snapshot',
            summary: {
                outcome: 'written',
                proposedChanges: 1,
                writtenChanges: 1,
                comparisons: 0,
                mismatches: 0,
                warnings: 1
            }
        } ]);
        scope.assert.equal(JSON.stringify(record).includes('private diagnostic payload'), false);
        scope.assert.deepEqual<unknown, unknown>(compactRunRecord(record), record);
        return scope.assert.collect();
    }),
    test('retains failed and blocked write outcomes', function (scope: TestScope) {
        const record = compactComparisons([ {
            ...snapshot,
            report: { ...snapshot.report, writeOutcome: { kind: 'failed', writtenChanges: [ change ] } }
        }, {
            ...snapshot,
            report: { ...snapshot.report, writeOutcome: { kind: 'blocked' } }
        } ]);
        scope.require.defined(record.result);
        scope.assert.partialDeepEqual(record.result.baselineReports, [ {
            summary: { outcome: 'failed', writtenChanges: 1 }
        }, {
            summary: { outcome: 'blocked', writtenChanges: 0 }
        } ]);
        return scope.assert.collect();
    }),
    test('retains benchmark mismatches and calibration publication counts', function (scope: TestScope) {
        const record = compactComparisons([ {
            kind: 'benchmark',
            report: {
                calibration,
                changes: [],
                writeOutcome: { kind: 'read-only' },
                comparisons: [ {
                    adapter: 'duration',
                    work: historyWork,
                    observation: {
                        kind: 'observed',
                        actual: { calibration, value: 'private diagnostic payload' },
                        expected: null,
                        comparison: {
                            kind: 'mismatch',
                            diagnostics: [ { actual: 2, expected: 1, summary: 'regression' } ]
                        }
                    },
                    presentation: { kind: 'unavailable', reason: 'fixture' }
                } ]
            }
        }, {
            kind: 'calibration',
            report: {
                outcome: 'failed',
                changes: [ { kind: 'write', path: 'calibration/reference.json' } ],
                completed: [ 'calibration/reference.json' ]
            }
        } ]);
        scope.require.defined(record.result);
        scope.assert.deepEqual(record.result.baselineReports, [ {
            kind: 'benchmark',
            summary: {
                outcome: 'read-only',
                proposedChanges: 0,
                writtenChanges: 0,
                comparisons: 1,
                mismatches: 1,
                warnings: 0
            }
        }, {
            kind: 'calibration',
            summary: {
                outcome: 'failed',
                proposedChanges: 1,
                writtenChanges: 1,
                comparisons: 0,
                mismatches: 0,
                warnings: 0
            }
        } ]);
        scope.assert.equal(JSON.stringify(record).includes('private diagnostic payload'), false);
        return scope.assert.collect();
    }),
    test('retains interrupted records without inventing results', function (scope: TestScope) {
        const record = compactRunRecord({
            ...completedHistoryRecord('interrupted'),
            status: 'interrupted',
            result: null
        });
        scope.assert.equal(record.status, 'interrupted');
        scope.assert.equal(record.result, null);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
