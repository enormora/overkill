import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import type { MeasurementInvocationEvidence } from '../engine/measurement-evidence.ts';
import type { AsyncMetricCollector, MetricCollector } from './measurement-types.ts';
import { createAsyncMeasurementSample, createMeasurementSample } from './measurement-region.ts';
import { asyncMeasurementStrategy, measurementStrategy } from './measurement-strategy.ts';
import { availableMetric } from './metric-reading.ts';
import { measurementContext, currentMeasurementContext } from './measurement-context.ts';

export const testNode: TestNode = suite('collector lifecycle ownership', [
    test('releases allocations registered by preparation before it throws', function (scope) {
        const events: string[] = [];
        const failure = new Error('partial preparation');
        const collector: MetricCollector = {
            name: 'partial',
            version: '1',
            mode: 'sync',
            metrics: [],
            prepare(context) {
                context.cleanup.defer(function releaseAllocation() {
                    events.push('release');
                });
                throw failure;
            }
        };
        scope.assert.throws(function () {
            createMeasurementSample(measurementStrategy([ collector ]), scope.signal).sample.measure(function () {
                events.push('operation');
            });
        }, { exact: failure });
        scope.assert.deepEqual(events, [ 'release' ]);
        return scope.assert.collect();
    }),
    test('continues stopping and finalizing collectors after a stop failure', function (scope) {
        const events: string[] = [];
        const failure = new Error('stop failed');
        function collector(name: string): MetricCollector {
            return {
                name,
                version: '1',
                mode: 'sync',
                metrics: [],
                prepare(context) {
                    context.cleanup.defer(function release() {
                        events.push(`release:${name}`);
                    });
                    return {
                        start() {
                            events.push(`start:${name}`);
                        },
                        stop() {
                            events.push(`stop:${name}`);
                            if (name === 'first') {
                                throw failure;
                            }
                        },
                        finalize(finalization) {
                            events.push(`finalize:${name}`);
                            return finalization.readings({});
                        }
                    };
                }
            };
        }
        scope.assert.throws(function () {
            createMeasurementSample(measurementStrategy([ collector('first'), collector('second') ]), scope.signal)
                .sample
                .measure(function () {
                    events.push('operation');
                });
        }, { exact: failure });
        scope.assert.deepEqual(events, [
            'start:first',
            'start:second',
            'operation',
            'stop:first',
            'stop:second',
            'finalize:first',
            'finalize:second',
            'release:second',
            'release:first'
        ]);
        return scope.assert.collect();
    }),
    test('cancellation interrupts readiness and uses a fresh finalization signal', async function (scope) {
        const controller = new AbortController();
        const started = Promise.withResolvers<undefined>();
        const cancelled = new Error('cancelled');
        const events: string[] = [];
        const collector: AsyncMetricCollector = {
            name: 'cancel',
            version: '1',
            mode: 'async',
            metrics: [],
            async prepare(context) {
                context.cleanup.defer(function release() {
                    events.push('released');
                });
                return {
                    async start() {
                        controller.abort(cancelled);
                        return started.promise;
                    },
                    stop(finalization) {
                        events.push(finalization.signal.aborted ? 'aborted' : 'fresh');
                    },
                    finalize(finalization) {
                        events.push('finalized');
                        return finalization.readings({});
                    }
                };
            }
        };
        try {
            await scope.assert.rejects(async function () {
                await createAsyncMeasurementSample(asyncMeasurementStrategy([ collector ]), controller.signal)
                    .sample
                    .measure(function () {
                        events.push('operation');
                    });
            }, { exact: cancelled });
        } finally {
            started.resolve(undefined);
        }
        scope.assert.deepEqual(events, [ 'fresh', 'finalized', 'released' ]);
        return scope.assert.collect();
    }),
    test('rejects finalization attributed to another invocation', function (scope) {
        const collector: MetricCollector = {
            name: 'stale',
            version: '1',
            mode: 'sync',
            metrics: [],
            prepare() {
                return {
                    start() {
                        return undefined;
                    },
                    stop() {
                        return undefined;
                    },
                    finalize(context) {
                        return {
                            ...context.readings({}),
                            invocation: { ...context.invocation, index: context.invocation.index + 1 }
                        };
                    }
                };
            }
        };
        scope.assert.throws(function () {
            createMeasurementSample(measurementStrategy([ collector ]), scope.signal).sample.measure(function () {
                return 1;
            });
        }, { message: 'Collector returned evidence for another invocation or target.' });
        return scope.assert.collect();
    }),
    test('retains unaffected readings and every failure in incomplete evidence', function (scope) {
        const evidence: MeasurementInvocationEvidence[] = [];
        const failure = new Error('finalize failed');
        const context = {
            ...currentMeasurementContext(),
            record(entry: MeasurementInvocationEvidence) {
                evidence.push(entry);
            }
        };
        const collector: MetricCollector = {
            name: 'broken',
            version: '1',
            mode: 'sync',
            metrics: [],
            prepare(preparation) {
                preparation.cleanup.defer(function release() {
                    throw new Error('release failed');
                });
                return {
                    start() {
                        return undefined;
                    },
                    stop() {
                        return undefined;
                    },
                    finalize() {
                        throw failure;
                    }
                };
            }
        };
        const metric = { name: 'count', collector: 'healthy', scope: 'custom' as const, unit: 'count' };
        const healthy: MetricCollector = {
            name: 'healthy',
            version: '1',
            mode: 'sync',
            metrics: [ metric ],
            prepare() {
                return {
                    start() {
                        return undefined;
                    },
                    stop() {
                        return undefined;
                    },
                    finalize(finalization) {
                        return finalization.readings({ count: availableMetric(7, metric) });
                    }
                };
            }
        };
        scope.assert.throws(function () {
            measurementContext.run(context, function runMeasurement() {
                createMeasurementSample(measurementStrategy([ collector, healthy ]), scope.signal).sample.measure(
                    function () {
                        return 1;
                    }
                );
            });
        }, { type: AggregateError });
        scope.assert.partialDeepEqual(evidence, [ {
            status: 'incomplete',
            errors: [ 'finalize failed', 'release failed' ],
            collectors: [
                { name: 'broken', result: null },
                { name: 'healthy', result: { readings: { count: { availability: 'available', value: 7 } } } }
            ]
        } ]);
        return scope.assert.collect();
    }),
    test('incomplete collector evidence cannot become an available metric', function (scope: TestScope) {
        const metric = { name: 'count', collector: 'incomplete', scope: 'custom' as const, unit: 'count' };
        const collector: MetricCollector = {
            name: 'incomplete',
            version: '1',
            mode: 'sync',
            metrics: [ metric ],
            prepare() {
                return {
                    start() {
                        return undefined;
                    },
                    stop() {
                        return undefined;
                    },
                    finalize(context) {
                        return {
                            ...context.readings({ count: availableMetric(0, metric) }),
                            completeness: { kind: 'incomplete', reasons: [ 'overflow' ] }
                        };
                    }
                };
            }
        };
        const measured = createMeasurementSample(measurementStrategy([ collector ]), scope.signal).sample.measure(
            function () {
                return 1;
            }
        );
        const reading = measured.metrics.count;
        scope.require.defined(reading);
        scope.assert.partialDeepEqual(reading, { availability: 'unavailable' });
        scope.assert.true(reading.availability === 'unavailable' && reading.reason === 'overflow');
        return scope.assert.collect();
    })
]);
