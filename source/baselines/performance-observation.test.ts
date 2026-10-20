import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { availableMetric, unavailableMetric } from '../bench/metric-reading.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import type { BenchmarkNormalizationEvidence, MetricReading } from '../engine/benchmark-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import type { PerformanceBaselineAdapter } from './performance-adapter.ts';
import { observePerformance } from './performance-observation.ts';

const provenance = { collector: 'storage', scope: 'custom', unit: 'ticks' } as const;
const work = createDefaultWorkId(createCaseId('storage.bench.ts', [], 'storage', null));
const calibration = { kind: 'comparable', machineClass: 'host', metadata: {}, context: {} } as const;
const adapter: PerformanceBaselineAdapter = {
    id: 'samples',
    observe(input) {
        const artifact = input.artifacts[0];
        return artifact?.payload.kind === 'runtime-attachment' && artifact.payload.content.kind === 'json'
            ? { kind: 'observed', value: artifact.payload.content.value }
            : { kind: 'not-applicable' };
    },
    propose(input) {
        return input.actual.value;
    },
    compare() {
        return { kind: 'match' };
    }
};
function samples(readings: readonly MetricReading[]): RuntimeAttachmentArtifact {
    return {
        id: { subtype: 'attachment', scope: { kind: 'run' }, attempt: null, runtimes: [], workload: null, sequence: 0 },
        source: 'native',
        payload: {
            kind: 'runtime-attachment',
            name: 'benchmark-samples',
            mediaType: 'application/json',
            capture: 'opt-in',
            capturedAtMicroseconds: 0,
            producer: { kind: 'case' },
            content: {
                kind: 'json',
                byteLength: 0,
                value: {
                    value: readings,
                    bytes: [ availableMetric(17, provenance) ],
                    constructor: [ availableMetric(19, provenance) ]
                }
            }
        }
    };
}
function normalization(cost: number): BenchmarkNormalizationEvidence {
    const actual = calibrationSnapshot([ cost, cost ]);
    const reference = calibrationSnapshot([ 1, 1 ]);
    return {
        version: 1,
        comparability: { kind: 'comparable' },
        calibrations: [ actual ],
        metrics: {
            value: {
                actual,
                reference,
                budgetReference: reference,
                source: 'canonical',
                scaling: 'proportional',
                factor: null,
                summary: null,
                budgets: []
            }
        }
    };
}
export const testNode = suite('performance observation normalization', [
    test(
        'normalizes adapter samples while retaining unavailable readings, raw metrics and original artifacts',
        function (scope: TestScope) {
            const unavailable = unavailableMetric('offline', provenance);
            const artifact = samples([ availableMetric(100, provenance), unavailable ]);
            const observed = observePerformance(
                adapter,
                { artifacts: [ artifact ], calibration, work },
                normalization(10),
                4096
            );
            scope.assert.deepEqual(observed, {
                kind: 'observed',
                value: {
                    value: [ availableMetric(10, provenance), unavailable ],
                    bytes: [ availableMetric(17, provenance) ],
                    constructor: [ availableMetric(19, provenance) ]
                }
            });
            scope.assert.partialDeepEqual(artifact.payload.content, {
                value: { value: [ availableMetric(100, provenance), unavailable ] }
            });
            return scope.assert.collect();
        }
    ),
    test('leaves other JSON attachments on their original scale', function (scope: TestScope) {
        const artifact = samples([ availableMetric(100, provenance) ]);
        const other = { ...artifact, payload: { ...artifact.payload, name: 'other-observations' } };
        scope.assert.deepEqual(
            observePerformance(adapter, { artifacts: [ other ], calibration, work }, normalization(10), 4096),
            {
                kind: 'observed',
                value: {
                    value: [ availableMetric(100, provenance) ],
                    bytes: [ availableMetric(17, provenance) ],
                    constructor: [ availableMetric(19, provenance) ]
                }
            }
        );
        return scope.assert.collect();
    }),
    test('preserves non-JSON sample evidence and inapplicable adapters', function (scope: TestScope) {
        const artifact = samples([]);
        const text = {
            ...artifact,
            payload: {
                ...artifact.payload,
                content: {
                    kind: 'text' as const,
                    text: 'unavailable',
                    byteLength: 11,
                    completion: { kind: 'complete' as const }
                }
            }
        };
        scope.assert.deepEqual(
            observePerformance(adapter, { artifacts: [ text ], calibration, work }, normalization(10), 4096),
            { kind: 'not-applicable' }
        );
        return scope.assert.collect();
    }),
    test('rejects overflowing normalized values before invoking an adapter', function (scope: TestScope) {
        const artifact = samples([ availableMetric(Number.MAX_VALUE, provenance) ]);
        scope.assert.throws(function () {
            return observePerformance(
                adapter,
                { artifacts: [ artifact ], calibration, work },
                normalization(0.5),
                4096
            );
        }, { message: 'Normalized performance observation is not finite.' });
        return scope.assert.collect();
    }),
    test('bounds normalized samples and final adapter observations', function (scope: TestScope) {
        const input = { artifacts: [ samples([ availableMetric(100, provenance) ]) ], calibration, work };
        scope.assert.throws(function () {
            return observePerformance(adapter, input, normalization(10), 1);
        }, { message: 'Normalized performance observation exceeds the configured artifact byte limit.' });
        scope.assert.throws(function () {
            return observePerformance(adapter, input, null, 1);
        }, { message: 'Performance observation exceeds the configured artifact byte limit.' });
        return scope.assert.collect();
    })
]);
