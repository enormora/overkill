import { mock } from 'node:test';
import { runInNewContext } from 'node:vm';
import { types as runtimeTypes } from 'node:util';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createAsyncMeasurementSample, createMeasurementSample } from './measurement-region.ts';
import { asyncMeasurementStrategy, measurementStrategy, wallClockMeasurement } from './measurement-strategy.ts';
import { availableMetric } from './metric-reading.ts';
import {
    memoryCollector,
    processCpuCollector,
    processResourceCollector,
    threadCpuCollector
} from './native-metric-collectors.ts';
import { runtimeHealthCollector, runtimeHealthReadings } from './runtime-health-collector.ts';
import type { AsyncMetricCollector, MetricCollector } from './measurement-types.ts';

function trackedCollector(name: string, record: (event: string) => void, disposalError: Error | null): MetricCollector {
    const metric = { name, collector: name, scope: 'custom' as const, unit: 'count' };
    return {
        name,
        mode: 'sync',
        metrics: [ metric ],
        prepare() {
            record(`prepare:${name}`);
            return {
                start() {
                    record(`start:${name}`);
                },
                stop() {
                    record(`stop:${name}`);
                },
                complete() {
                    record(`complete:${name}`);
                    return { [name]: availableMetric(1, metric) };
                },
                dispose() {
                    record(`dispose:${name}`);
                    if (disposalError !== null) {
                        throw disposalError;
                    }
                }
            };
        }
    };
}

function actionError(action: () => unknown): unknown {
    try {
        return action();
    } catch (error: unknown) {
        return error;
    }
}

export const testNode = suite('measurement regions and collectors', [
    test('marks throughput unavailable when the wall clock cannot resolve the region', function (scope) {
        const clock = mock.method(process.hrtime, 'bigint', function () {
            return 0n;
        });
        try {
            const measured = createMeasurementSample(wallClockMeasurement(), scope.signal).sample.measure(function () {
                return 3;
            });
            scope.assert.equal(measured.metrics.durationMicroseconds.availability, 'available');
            scope.assert.equal(measured.metrics.operationsPerSecond.availability, 'unavailable');
            return scope.assert.collect();
        } finally {
            clock.mock.restore();
        }
    }),
    test('awaits asynchronous values and preserves asynchronous disposal failures', async function (scope) {
        const measured = await createAsyncMeasurementSample(asyncMeasurementStrategy([]), scope.signal)
            .sample
            .measure(async function () {
                return await Promise.resolve(7);
            });
        scope.assert.equal(measured.value, 7);
        const failure = new Error('disposal');
        const strategy = asyncMeasurementStrategy([ trackedCollector('failure', function () {
            return undefined;
        }, failure) ]);
        await scope.assert.rejects(async function () {
            return createAsyncMeasurementSample(strategy, scope.signal).sample.measure(function () {
                return 1;
            });
        }, { exact: failure });
        return scope.assert.collect();
    }),
    test('requires both process resource snapshots before reporting counters', function (scope) {
        for (const boundary of [ 'none', 'start', 'stop' ]) {
            const session = processResourceCollector().prepare(scope.signal);
            if (boundary === 'start') {
                session.start();
            } else if (boundary === 'stop') {
                session.stop();
            }
            scope.assert.throws(function () {
                return session.complete();
            }, { message: 'Resource measurement requires start and stop.' });
            session.dispose();
        }
        return scope.assert.collect();
    }),
    test('disposes asynchronous collectors after preparation and action failures', async function (scope) {
        const events: string[] = [];
        const failure = new Error('async preparation');
        const collector: AsyncMetricCollector = {
            name: 'failure',
            mode: 'async',
            metrics: [],
            async prepare() {
                throw failure;
            }
        };
        const strategy = asyncMeasurementStrategy([
            trackedCollector('prepared', function (event) {
                events.push(event);
            }, null),
            collector
        ]);
        await scope.assert.rejects(async function () {
            return createAsyncMeasurementSample(strategy, scope.signal).sample.measure(function () {
                return 1;
            });
        }, { exact: failure });
        scope.assert.deepEqual(events, [ 'prepare:prepared', 'dispose:prepared' ]);
        await scope.assert.rejects(async function () {
            return createMeasurementSample(wallClockMeasurement(), scope.signal).sample.measure(async function () {
                throw failure;
            });
        }, { exact: failure });
        await scope.assert.rejects(async function () {
            return createAsyncMeasurementSample(asyncMeasurementStrategy([]), scope.signal).sample.measure(
                async function () {
                    throw failure;
                }
            );
        }, { exact: failure });
        return scope.assert.collect();
    }),
    test('rejects asynchronous cancellation before preparing runtime observers', async function (scope) {
        const failure = new Error('cancelled');
        await scope.assert.rejects(async function () {
            return runtimeHealthCollector().prepare(AbortSignal.abort(failure));
        }, { type: Error });
        scope.assert.equal(runtimeHealthReadings([]).gcObservedCount?.availability, 'unavailable');
        return scope.assert.collect();
    }),
    test('rejects invalid region callbacks and operations before collector acquisition', function (scope) {
        const events: string[] = [];
        const strategy = measurementStrategy([ trackedCollector('unused', function (event) {
            events.push(event);
        }, null) ]);
        for (const count of [ -1, 0.5, Number.POSITIVE_INFINITY ]) {
            scope.assert.throws(function () {
                return createMeasurementSample(strategy, scope.signal).sample.measure(count, function () {
                    return 1;
                });
            }, { type: TypeError });
        }
        scope.assert.throws(function () {
            const lifecycle = createMeasurementSample(strategy, scope.signal);
            Reflect.apply(lifecycle.sample.measure, undefined, [ 1, null ]);
        }, { type: TypeError });
        scope.assert.deepEqual(events, []);
        return scope.assert.collect();
    }),
    test('awaits promises created in another JavaScript context', async function (scope) {
        const foreign: unknown = runInNewContext('Promise.resolve(7)');
        if (!runtimeTypes.isPromise(foreign)) {
            throw new TypeError('Expected a native promise from the other context.');
        }
        const lifecycle = createMeasurementSample(wallClockMeasurement(), scope.signal);
        const returned = lifecycle.sample.measure(async function () {
            return foreign;
        });
        scope.assert.true(returned instanceof Promise);
        const measured = await returned;
        scope.assert.true(measured.value === 7);
        lifecycle.ensureMeasured();
        return scope.assert.collect();
    }),
    test('cancellation during async preparation disposes collectors before invoking work', async function (scope) {
        const controller = new AbortController();
        const cancelled = new Error('cancelled during preparation');
        const counts = { actions: 0, disposed: 0 };
        const collector: AsyncMetricCollector = {
            name: 'cancelled',
            mode: 'async',
            metrics: [],
            async prepare() {
                await Promise.resolve();
                controller.abort(cancelled);
                return {
                    start() {
                        return undefined;
                    },
                    stop() {
                        return undefined;
                    },
                    async complete() {
                        return {};
                    },
                    async dispose() {
                        counts.disposed += 1;
                    }
                };
            }
        };
        const lifecycle = createAsyncMeasurementSample(asyncMeasurementStrategy([ collector ]), controller.signal);
        await scope.assert.rejects(async function () {
            return lifecycle.sample.measure(function () {
                counts.actions += 1;
            });
        }, { exact: cancelled });
        scope.assert.equal(counts.actions, 0);
        scope.assert.equal(counts.disposed, 1);
        return scope.assert.collect();
    }),
    test('empty runtime histograms remain unavailable rather than zero', function (scope) {
        const readings = runtimeHealthReadings([ null, null, 0, 0, 0 ]);
        scope.assert.equal(readings.eventLoopDelayMeanMicroseconds?.availability, 'unavailable');
        scope.assert.equal(readings.eventLoopDelayMaximumMicroseconds?.availability, 'unavailable');
        scope.assert.equal(readings.gcObservedCount?.availability, 'available');
        return scope.assert.collect();
    }),
    test('preserves synchronous operation results and runs collectors outside the action', function (scope) {
        const events: string[] = [];
        const lifecycle = createMeasurementSample(
            measurementStrategy([
                trackedCollector('first', function (event) {
                    events.push(event);
                }, null),
                trackedCollector('second', function (event) {
                    events.push(event);
                }, null)
            ]),
            scope.signal
        );
        const measured = lifecycle.sample.measure(4, function () {
            events.push('action');
            return 7;
        });
        lifecycle.ensureMeasured();
        scope.assert.false(measured instanceof Promise);
        scope.assert.equal(measured.value, 7);
        scope.assert.deepEqual(events, [
            'prepare:first',
            'prepare:second',
            'start:first',
            'start:second',
            'action',
            'stop:first',
            'stop:second',
            'complete:first',
            'complete:second',
            'dispose:second',
            'dispose:first'
        ]);
        scope.assert.equal(measured.metrics.operationsPerSecond.availability, 'available');
        scope.assert.equal(measured.metrics.durationMicroseconds.provenance.unit, 'microseconds');
        return scope.assert.collect();
    }),
    test('invokes asynchronous actions once and awaits their completion', async function (scope) {
        let calls = 0;
        const lifecycle = createMeasurementSample(wallClockMeasurement(), scope.signal);
        const promised = lifecycle.sample.measure(async function () {
            calls += 1;
            return await Promise.resolve(3);
        });
        scope.assert.true(promised instanceof Promise);
        const measured = await promised;
        scope.assert.equal(measured.value, 3);
        scope.assert.equal(calls, 1);
        return scope.assert.collect();
    }),
    test('preserves action and disposal errors with reverse cleanup', function (scope: TestScope) {
        const events: string[] = [];
        const [ primary, secondary ] = [ new Error('action'), new Error('disposal') ];
        const lifecycle = createMeasurementSample(
            measurementStrategy([
                trackedCollector('first', function (event) {
                    events.push(event);
                }, null),
                trackedCollector('second', function (event) {
                    events.push(event);
                }, secondary)
            ]),
            scope.signal
        );
        const caught = actionError(function () {
            lifecycle.sample.measure(function () {
                throw primary;
            });
        });
        scope.require.instanceOf(caught, AggregateError);
        scope.assert.deepEqual(caught.errors, [ primary, secondary ]);
        scope.assert.deepEqual(events.slice(-2), [ 'dispose:second', 'dispose:first' ]);
        return scope.assert.collect();
    }),
    test('disposes prepared collectors when a later collector fails to prepare', function (scope) {
        const events: string[] = [];
        const error = new Error('prepare');
        const failure: MetricCollector = {
            ...trackedCollector('second', function (event) {
                events.push(event);
            }, null),
            prepare() {
                throw error;
            }
        };
        const lifecycle = createMeasurementSample(
            measurementStrategy([
                trackedCollector('first', function (event) {
                    events.push(event);
                }, null),
                failure
            ]),
            scope.signal
        );
        scope.assert.throws(function () {
            return lifecycle.sample.measure(function () {
                return 1;
            });
        }, { exact: error });
        scope.assert.deepEqual(events, [ 'prepare:first', 'dispose:first' ]);
        return scope.assert.collect();
    }),
    test('rejects cancellation and invalid operation counts before invoking work', function (scope) {
        const signal = AbortSignal.abort(new Error('cancelled'));
        let calls = 0;
        scope.assert.throws(function () {
            return createMeasurementSample(wallClockMeasurement(), signal).sample.measure(function () {
                calls += 1;
            });
        }, { message: 'cancelled' });
        scope.assert.throws(
            function () {
                return createMeasurementSample(wallClockMeasurement(), scope.signal).sample.measure(0, function () {
                    calls += 1;
                });
            },
            { type: TypeError }
        );
        scope.assert.equal(calls, 0);
        return scope.assert.collect();
    }),
    test('reports native counter units and scopes without attributing process data to a thread', function (scope) {
        const lifecycle = createMeasurementSample(
            measurementStrategy([
                threadCpuCollector(),
                processCpuCollector(),
                memoryCollector(),
                processResourceCollector()
            ]),
            scope.signal
        );
        const measured = lifecycle.sample.measure(function () {
            return new Uint8Array(4096);
        });
        scope.assert.equal(measured.value.length, 4096);
        for (
            const [ name, field, expected ] of [
                [ 'threadCpuTotalMicroseconds', 'scope', 'thread' ],
                [ 'processCpuTotalMicroseconds', 'scope', 'process' ],
                [ 'residentSetBytes', 'scope', 'process' ],
                [ 'heapUsedBytesDelta', 'unit', 'bytes' ],
                [ 'processMaximumResidentSetBytes', 'unit', 'bytes' ],
                [ 'fsReadDelta', 'unit', 'count' ]
            ] as const
        ) {
            scope.assert.equal(measured.metrics[name]?.provenance[field], expected);
        }
        for (const reading of Object.values(measured.metrics)) {
            scope.assert.deepEqual(
                Object.keys(reading.provenance).toSorted(function (left, right) {
                    return left.localeCompare(right);
                }),
                [ 'collector', 'scope', 'unit' ]
            );
        }
        return scope.assert.collect();
    }),
    test('primes observers without inventing loop observations for synchronous work', async function (scope) {
        const lifecycle = createAsyncMeasurementSample(
            asyncMeasurementStrategy([ runtimeHealthCollector() ]),
            scope.signal
        );
        const measured = await lifecycle.sample.measure(function () {
            const started = process.hrtime.bigint();
            let elapsed = 0n;
            while (elapsed < 1_000_000n) {
                elapsed = process.hrtime.bigint() - started;
            }
            return 'complete';
        });
        scope.assert.equal(measured.value, 'complete');
        scope.assert.equal(measured.metrics.eventLoopDelayMeanMicroseconds?.provenance.scope, 'runtime');
        scope.assert.equal(measured.metrics.eventLoopDelayMeanMicroseconds?.availability, 'unavailable');
        scope.assert.equal(measured.metrics.gcObservedDurationMicroseconds?.provenance.unit, 'microseconds');
        return scope.assert.collect();
    })
]);
