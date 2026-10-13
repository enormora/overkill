import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { ChartedPerformanceBaselineAdapter, PerformanceBaselineAdapter } from './performance-adapter.ts';
import { presentPerformanceMetrics } from './performance-presentation.ts';
import { performanceReportArtifact, readPerformanceBaselineReport } from './performance-report.ts';

const calibration = { context: {}, kind: 'comparable', machineClass: 'test', metadata: {} } as const;
const observation = {
    kind: 'observed',
    actual: { calibration, value: 2 },
    expected: { calibration, value: 1 },
    comparison: { kind: 'match' }
} as const;
const adapter: PerformanceBaselineAdapter = {
    id: 'latency',
    observe() {
        return { kind: 'observed', value: 2 };
    },
    compare() {
        return { kind: 'match' };
    },
    propose(input) {
        return input.actual.value;
    }
};
export const testNode = suite('performance chart presentation', [
    test('accepts declared normalized values', function (scope: TestScope) {
        const charted: ChartedPerformanceBaselineAdapter = {
            ...adapter,
            describeMetrics() {
                return [ {
                    name: 'median',
                    unit: 'ms',
                    scale: { kind: 'normalized', description: 'CPU reference' },
                    actual: 2,
                    expected: { kind: 'value', value: 1 }
                } ];
            }
        };
        scope.assert.partialDeepEqual(presentPerformanceMetrics(charted, observation), {
            kind: 'available',
            metrics: [ { actual: 2, expected: { kind: 'value', value: 1 } } ]
        });
        return scope.assert.collect();
    }),
    test('records invalid chart metadata without throwing away comparison evidence', function (scope: TestScope) {
        const charted: ChartedPerformanceBaselineAdapter = {
            ...adapter,
            describeMetrics() {
                return [ {
                    name: 'median',
                    unit: 'ms',
                    scale: { kind: 'raw' },
                    actual: Number.NaN,
                    expected: { kind: 'range', minimum: 5, maximum: 1 }
                } ];
            }
        };
        scope.assert.equal(presentPerformanceMetrics(charted, observation).kind, 'error');
        scope.assert.equal(presentPerformanceMetrics(adapter, observation).kind, 'unavailable');
        return scope.assert.collect();
    }),
    test('rejects reports that exceed the artifact limit', function (scope: TestScope) {
        scope.assert.throws(function oversizedReport() {
            performanceReportArtifact({
                capturedAtMicroseconds: 0,
                maxBytes: 1,
                report: { calibration, changes: [], writeOutcome: { kind: 'read-only' } },
                result: runResultFactory.build({})
            });
        }, { message: 'performance-baselines report exceeds the configured artifact byte limit.' });
        return scope.assert.collect();
    }),
    test('reads saved legacy baseline reports without inventing chart metadata', function (scope: TestScope) {
        const result = runResultFactory.build();
        const artifact = performanceReportArtifact({
            result,
            maxBytes: 4096,
            capturedAtMicroseconds: 0,
            report: { calibration, changes: [], writeOutcome: { kind: 'read-only' } }
        });
        const restored = readPerformanceBaselineReport({ ...result, artifacts: [ artifact ] });
        scope.require.defined(restored);
        scope.assert.partialDeepEqual(restored, { version: 2, comparisons: [], writeOutcome: { kind: 'read-only' } });
        return scope.assert.collect();
    })
]);
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
