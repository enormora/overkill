import { getEventListeners } from 'node:events';
import type { BenchmarkScope } from '../engine/test-node.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import {
    availableMetric,
    defineCalibrationResource,
    processMeasurement,
    wallClockMeasurement,
    workload,
    type CalibrationResource,
    type BenchmarkMeasureContext,
    type BenchmarkExecutionResult,
    type MetricReading
} from '../packages/bench/bench.entry-point.ts';
import { startResources } from '../packages/resources/resources.entry-point.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { sampleCalibration, createCalibrationSampler, type CalibrationSamplingInput } from './calibration-sampling.ts';
import { calibrationResourceKey, collectBenchmarkNormalization } from './benchmark-normalization.ts';

const reference = calibrationSnapshot(Array.from({ length: 128 }, function () {
    return 100;
}));
const policy = { ...reference.sampling, minimumSamples: 16, maximumSamples: 16 };
type ReferenceContext = BenchmarkMeasureContext<Readonly<Record<string, never>>>;
function calibrationScope(scope: TestScope): BenchmarkScope {
    const selectedWorkload = { name: 'one', params: {} };
    const workId = {
        ...createDefaultWorkId(createCaseId('reference.bench.ts', [], 'reference', null)),
        workload: selectedWorkload
    };
    return {
        workId,
        workload: selectedWorkload,
        signal: scope.signal,
        cleanup: scope.cleanup,
        benchmarkEnvironment: {
            profileGarbageCollection: 'off',
            garbageCollection: { kind: 'unavailable', reason: 'GC unavailable' },
            normalization: {
                mode: 'compare',
                profile: 'bench',
                machine: {
                    machineClass: reference.machineClass,
                    metadata: reference.metadata
                },
                references: [ reference ],
                saved: []
            }
        },
        reportCleanupError(error) {
            throw new Error('Unexpected calibration cleanup failure.', { cause: error });
        },
        reportError(error) {
            throw error;
        },
        async updateResult() {
            throw new Error('Sampling must not update benchmark results.');
        }
    };
}
type ReferenceReadings = Readonly<Record<'reference', MetricReading>>;
function measuredReference(context: ReferenceContext): ReferenceReadings {
    return {
        reference: availableMetric(
            context
                .sample
                .measure(function () {
                    return 200;
                })
                .value,
            {
                collector: 'reference',
                scope: 'custom',
                unit: 'ticks'
            }
        )
    };
}
function samplingInput(
    scope: BenchmarkScope,
    body: CalibrationSamplingInput['body'],
    minimumSamples: number
): CalibrationSamplingInput {
    return {
        scope,
        body,
        workload: workload('reference', {}),
        measurement: wallClockMeasurement(),
        lifecycle: { ...reference.lifecycle, garbageCollection: 'off' },
        context: {},
        budgets: [],
        diagnostics: [ 'reference' ],
        policy: { ...policy, minimumSamples, maximumSamples: minimumSamples }
    };
}
function referenceResource(): CalibrationResource {
    return defineCalibrationResource({
        workload: workload('reference', {}),
        version: '1',
        unit: 'ticks',
        dependencies: {},
        measurement: wallClockMeasurement(),
        measure(context) {
            return measuredReference({ ...context, workload: workload('reference', {}) }).reference;
        }
    }, { sampling: policy, lifecycle: reference.lifecycle });
}
export const testNode = suite('calibration sampling lifetimes', [
    test(
        'caches reference samples within a context and refreshes them for a new run',
        async function (scope: TestScope) {
            let samples = 0;
            const sampler = createCalibrationSampler(reference.identity);
            const input = samplingInput(calibrationScope(scope), function measured(context) {
                samples += 1;
                return measuredReference(context);
            }, 128);
            const first = await sampler.sample(input);
            scope.assert.equal(await sampler.sample({ ...input }), first);
            scope.assert.equal(samples, 128);
            await sampler.sample({ ...input, scope: calibrationScope(scope) });
            scope.assert.equal(samples, 256);
            return scope.assert.collect();
        }
    ),
    ...[ false, true ].map(function missingContextCase(missingEnvironment) {
        return test(
            `rejects missing ${missingEnvironment ? 'execution environment' : 'normalization context'}`,
            async function (scope: TestScope) {
                const original = calibrationScope(scope);
                const missing = {
                    ...original,
                    benchmarkEnvironment: missingEnvironment ? null : {
                        profileGarbageCollection: 'off' as const,
                        garbageCollection: { kind: 'unavailable' as const, reason: 'GC unavailable' },
                        normalization: null
                    }
                };
                scope.assert.deepEqual(
                    await sampleCalibration(reference.identity, samplingInput(missing, measuredReference, 16)),
                    {
                        kind: 'non-comparable',
                        reason: 'Calibration requires a benchmark runner reference context.',
                        samples: []
                    }
                );
                return scope.assert.collect();
            }
        );
    }),
    test('excludes warmup readings and cleans up every calibration invocation', async function (scope: TestScope) {
        let calls = 0;
        let cleaned = 0;
        const input = samplingInput(calibrationScope(scope), function collectReference(context: ReferenceContext) {
            calls += 1;
            context.sample.cleanup(function () {
                cleaned += 1;
            });
            return measuredReference(context);
        }, 16);
        const result = await sampleCalibration(reference.identity, {
            ...input,
            lifecycle: { ...input.lifecycle, warmupSamples: 2 }
        });
        scope.assert.equal(result.kind, 'comparable');
        scope.assert.equal(calls, 18);
        scope.assert.equal(cleaned, 18);
        if (result.kind === 'comparable') {
            scope.assert.deepEqual(
                result.snapshot.samples,
                Array.from({ length: 16 }, function () {
                    return 200;
                })
            );
        }
        return scope.assert.collect();
    }),
    test('stops with retained samples when the precision limit is exhausted', async function (scope: TestScope) {
        scope.assert.deepEqual(
            await sampleCalibration(reference.identity, samplingInput(calibrationScope(scope), measuredReference, 2)),
            {
                kind: 'non-comparable',
                reason: 'Calibration sampling limit reached before reference precision.',
                samples: [ 200, 200 ]
            }
        );
        return scope.assert.collect();
    }),
    ...[ 0, 2 ].map(function failedPhaseCase(warmupSamples) {
        return test(
            `retains only measured evidence after a ${warmupSamples === 0 ? 'measurement' : 'warmup'} failure`,
            async function (scope: TestScope) {
                let calls = 0;
                let cleaned = 0;
                const input = samplingInput(
                    calibrationScope(scope),
                    function failingReference(context: ReferenceContext) {
                        calls += 1;
                        context.sample.cleanup(function () {
                            cleaned += 1;
                        });
                        const reading = measuredReference(context);
                        if (calls === 2) {
                            throw new Error('reference failed');
                        }
                        return reading;
                    },
                    16
                );
                scope.assert.deepEqual(
                    await sampleCalibration(reference.identity, {
                        ...input,
                        lifecycle: { ...input.lifecycle, warmupSamples }
                    }),
                    { kind: 'non-comparable', reason: 'reference failed', samples: warmupSamples === 0 ? [ 200 ] : [] }
                );
                scope.assert.equal(calls, 2);
                scope.assert.equal(cleaned, 2);
                return scope.assert.collect();
            }
        );
    }),
    test('honors cancellation before taking a reference sample', async function (scope: TestScope) {
        const controller = new AbortController();
        const input = samplingInput({ ...calibrationScope(scope), signal: controller.signal }, measuredReference, 16);
        controller.abort('calibration cancelled');
        scope.assert.deepEqual(await sampleCalibration(reference.identity, input), {
            kind: 'non-comparable',
            reason: 'calibration cancelled',
            samples: []
        });
        return scope.assert.collect();
    }),
    test('disposes process sessions when a reference callback fails', async function (scope: TestScope) {
        const controller = new AbortController();
        const input = samplingInput(
            { ...calibrationScope(scope), signal: controller.signal },
            function failedProcessReference() {
                throw new Error('process reference failed');
            },
            16
        );
        const listeners = getEventListeners(controller.signal, 'abort').length;
        scope.assert.deepEqual(
            await sampleCalibration(reference.identity, {
                ...input,
                measurement: processMeasurement({ instrumentation: 'off' })
            }),
            {
                kind: 'non-comparable',
                reason: 'process reference failed',
                samples: []
            }
        );
        scope.assert.equal(getEventListeners(controller.signal, 'abort').length, listeners);
        return scope.assert.collect();
    }),
    test('rejects unavailable requested garbage collection before sampling', async function (scope: TestScope) {
        const input = samplingInput(calibrationScope(scope), measuredReference, 16);
        scope.assert.deepEqual(
            await sampleCalibration(reference.identity, {
                ...input,
                lifecycle: { ...input.lifecycle, garbageCollection: 'after-sample' }
            }),
            { kind: 'non-comparable', reason: 'GC unavailable', samples: [] }
        );
        return scope.assert.collect();
    }),
    test('retains non-Error cancellation reasons from calibration sessions', async function (scope: TestScope) {
        const calibration = referenceResource();
        const rules = { value: { calibration, scaling: 'proportional' as const } };
        const cancellation = AbortSignal.abort('reference cancelled');
        const handles = {
            [calibrationResourceKey(rules.value)]: {
                async collect() {
                    cancellation.throwIfAborted();
                    return { kind: 'comparable', snapshot: reference };
                }
            }
        };
        const retained: BenchmarkExecutionResult[] = [];
        await scope.assert.rejects(async function () {
            return await collectBenchmarkNormalization(
                {
                    ...calibrationScope(scope),
                    async updateResult(result) {
                        retained.push(result);
                    }
                },
                handles,
                rules,
                policy
            );
        }, { message: 'reference cancelled' });
        scope.assert.deepEqual(
            retained.map(function (result) {
                return { status: result.status, comparability: result.normalization?.comparability };
            }),
            [ { status: 'incomplete', comparability: { kind: 'non-comparable', reason: 'reference cancelled' } } ]
        );
        return scope.assert.collect();
    }),
    ...[ false, true ].map(function failedContextCase(cached) {
        return test(
            `retains calibration evidence when a ${cached ? 'cached' : 'new'} resource loses its runner context`,
            async function (scope: TestScope) {
                const calibration = referenceResource();
                const rules = { value: { calibration, scaling: 'proportional' as const } };
                await using resources = await startResources({ resources: { calibration }, signal: scope.signal });
                const handles = { [calibrationResourceKey(rules.value)]: resources.context.calibration };
                if (cached) {
                    await collectBenchmarkNormalization(calibrationScope(scope), handles, rules, policy);
                }
                const retained: BenchmarkExecutionResult[] = [];
                await scope.assert.rejects(
                    async function () {
                        return await collectBenchmarkNormalization(
                            {
                                ...calibrationScope(scope),
                                benchmarkEnvironment: null,
                                async updateResult(result) {
                                    retained.push(result);
                                }
                            },
                            handles,
                            rules,
                            policy
                        );
                    },
                    {
                        message: cached
                            ? 'Normalization requires a benchmark runner reference context.'
                            : 'Calibration requires a benchmark runner reference context.'
                    }
                );
                scope.assert.deepEqual(
                    retained.map(function (result) {
                        return { status: result.status, samples: result.normalization?.calibrations.length };
                    }),
                    [
                        { status: 'incomplete', samples: cached ? 1 : 0 }
                    ]
                );
                return scope.assert.collect();
            }
        );
    })
]);
