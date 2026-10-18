import { setTimeout as delay } from 'node:timers/promises';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createRoot, createTestPlan, execute } from '../packages/engine/engine.entry-point.ts';
import {
    measureConstantValue,
    executeGarbageCollectionBenchmark,
    garbageCollectionBenchmark,
    shortLifecycle
} from '../test-support/benchmark-garbage-collection-fixture.ts';
import type { BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import type { RunResult } from '../engine/run-result.ts';
import { benchmarkResultSchema } from '../run/benchmark-result-schema.ts';

function measuredBenchmark(result: RunResult): BenchmarkExecutionResult {
    const measured = result.perTest[0]?.benchmark;
    if (measured === null || measured === undefined) {
        throw new Error('Missing benchmark evidence.');
    }
    return measured;
}

function assertCombinedFailures(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.summary.failed, 1);
    const outcome = result.perTest[0]?.outcome;
    if (outcome?.kind !== 'fail') {
        throw new Error('Expected a failed benchmark.');
    }
    scope.assert.partialDeepEqual(outcome, {
        kind: 'fail',
        failures: [
            { kind: 'body-error', error: { message: 'body failed' } },
            { kind: 'cleanup-error', error: { message: 'cleanup failed' } }
        ]
    });
    scope.assert.partialDeepEqual(result.runnerErrors, [ {
        subtype: 'measurement',
        message: 'Benchmark garbage collection failed.'
    } ]);
    scope.require.defined(measuredBenchmark(result).lifecycle);
    scope.assert.partialDeepEqual(measuredBenchmark(result).lifecycle ?? {}, {
        garbageCollection: { mode: 'after-sample', completed: 0, failures: 1 }
    });
}

export const testNode = suite('explicit benchmark garbage collection', [
    test(
        'collects after every warmup and measured cleanup outside the measured region',
        async function (scope: TestScope) {
            const events: string[] = [];
            const node = garbageCollectionBenchmark(function ({ sample }) {
                events.push('prepare');
                sample.cleanup(function () {
                    events.push('first cleanup');
                });
                sample.cleanup(function () {
                    events.push('second cleanup');
                });
                return {
                    value: sample
                        .measure(function () {
                            events.push('measure');
                            return 1;
                        })
                        .value
                };
            }, shortLifecycle);
            const result = await executeGarbageCollectionBenchmark(node, {
                profileGarbageCollection: 'off',
                garbageCollection: {
                    kind: 'available',
                    collect() {
                        events.push('gc');
                    }
                }
            });
            scope.assert.equal(result.summary.passed, 1);
            scope.assert.deepEqual(
                events,
                Array
                    .from({ length: 3 }, function () {
                        return [
                            'prepare',
                            'measure',
                            'second cleanup',
                            'first cleanup',
                            'gc'
                        ];
                    })
                    .flat()
            );
            scope.assert.partialDeepEqual(measuredBenchmark(result), {
                samples: 2,
                lifecycle: { version: 2, garbageCollection: { mode: 'after-sample', completed: 3, failures: 0 } }
            });
            return scope.assert.collect();
        }
    ),
    ...([ 'off', 'after-sample' ] as const).flatMap(function profileCases(profile) {
        return ([ 'off', 'after-sample', 'profile-default' ] as const).map(function requestedPolicy(request) {
            return test(`${profile} profile with ${request} benchmark policy`, async function (scope: TestScope) {
                let collections = 0;
                const effective = request === 'profile-default' ? profile : request;
                const result = await executeGarbageCollectionBenchmark(
                    garbageCollectionBenchmark(measureConstantValue, {
                        ...shortLifecycle,
                        warmupSamples: 0,
                        garbageCollection: request
                    }),
                    {
                        profileGarbageCollection: profile,
                        garbageCollection: {
                            kind: 'available',
                            collect() {
                                collections += 1;
                            }
                        }
                    }
                );
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(collections, effective === 'off' ? 0 : 2);
                scope.assert.equal(measuredBenchmark(result).lifecycle?.policy.garbageCollection, effective);
                return scope.assert.collect();
            });
        });
    }),
    test('rejects requested GC before invoking a direct engine benchmark', async function (scope: TestScope) {
        let calls = 0;
        const node = garbageCollectionBenchmark(function ({ sample }) {
            calls += 1;
            return {
                value: sample
                    .measure(function () {
                        return 1;
                    })
                    .value
            };
        }, shortLifecycle);
        const result = await execute(createTestPlan(createRoot({
            title: 'root',
            children: [ node ],
            annotations: {},
            controls: {}
        })));
        scope.assert.equal(calls, 0);
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
        scope.assert.equal(result.perTest[0]?.benchmark?.status, 'incomplete');
        return scope.assert.collect();
    }),
    test(
        'preserves body, cleanup and GC failures while stopping further invocations',
        async function (scope: TestScope) {
            const events: string[] = [];
            const result = await executeGarbageCollectionBenchmark(
                garbageCollectionBenchmark(function ({ sample }) {
                    sample.cleanup(function () {
                        events.push('cleanup');
                        throw new Error('cleanup failed');
                    });
                    sample.cleanup(function () {
                        events.push('remaining cleanup');
                    });
                    sample.measure(function () {
                        return 1;
                    });
                    throw new Error('body failed');
                }, shortLifecycle),
                {
                    profileGarbageCollection: 'off',
                    garbageCollection: {
                        kind: 'available',
                        collect() {
                            events.push('gc');
                            throw new Error('gc failed');
                        }
                    }
                }
            );
            scope.assert.deepEqual(events, [ 'remaining cleanup', 'cleanup', 'gc' ]);
            assertCombinedFailures(scope, result);
            return scope.assert.collect();
        }
    ),
    test('retains validated readings when collection fails', async function (scope: TestScope) {
        const result = await executeGarbageCollectionBenchmark(
            garbageCollectionBenchmark(function ({ sample }) {
                return {
                    value: sample
                        .measure(function () {
                            return 1;
                        })
                        .value
                };
            }, { ...shortLifecycle, warmupSamples: 0 }),
            {
                profileGarbageCollection: 'off',
                garbageCollection: {
                    kind: 'available',
                    collect() {
                        throw new Error('gc failed');
                    }
                }
            }
        );
        scope.assert.partialDeepEqual(measuredBenchmark(result), {
            samples: 1,
            status: 'incomplete',
            metrics: { value: { count: 1 } }
        });
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
        return scope.assert.collect();
    }),
    test('skips GC after cancellation during cleanup', async function (scope: TestScope) {
        let collections = 0;
        const result = await executeGarbageCollectionBenchmark(
            garbageCollectionBenchmark(function ({ sample, signal }) {
                sample.cleanup(async function () {
                    await delay(1000, undefined, { signal });
                });
                return {
                    value: sample
                        .measure(function () {
                            return 1;
                        })
                        .value
                };
            }, { ...shortLifecycle, warmupSamples: 0 }),
            {
                profileGarbageCollection: 'off',
                garbageCollection: {
                    kind: 'available',
                    collect() {
                        collections += 1;
                    }
                }
            }
        );
        scope.assert.equal(collections, 0);
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('decodes historical lifecycle evidence without inventing GC observations', async function (scope: TestScope) {
        const result = await executeGarbageCollectionBenchmark(
            garbageCollectionBenchmark(function ({ sample }) {
                return {
                    value: sample
                        .measure(function () {
                            return 1;
                        })
                        .value
                };
            }, { ...shortLifecycle, garbageCollection: 'off' }),
            null
        );
        const measured = result.perTest[0]?.benchmark;
        scope.require.defined(measured);
        scope.require.defined(measured.lifecycle);
        const { garbageCollection: _evidence, policy, ...lifecycle } = measured.lifecycle;
        const { garbageCollection: _policy, ...historicalPolicy } = policy;
        const restored = benchmarkResultSchema.parse({
            ...measured,
            lifecycle: { ...lifecycle, version: 1, policy: historicalPolicy }
        });
        scope.assert.equal(restored.lifecycle?.garbageCollection, null);
        scope.assert.equal(restored.lifecycle?.policy.garbageCollection, 'off');
        return scope.assert.collect();
    })
]);
