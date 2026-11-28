import { getEventListeners } from 'node:events';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { captureRejectedError } from '../test-support/captured-error.ts';
import type { BenchmarkScope } from '../engine/test-node.ts';
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
import { calibrationScope, calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { sampleCalibration, createCalibrationSampler, type CalibrationSamplingInput } from './calibration-sampling.ts';
import { calibrationResourceKey, collectBenchmarkNormalization } from './benchmark-normalization.ts';
import { benchmarkNormalizationContextSchema } from './calibration-evidence.ts';

const reference = calibrationSnapshot(Array.from({ length: 128 }, function () {
    return 100;
}));
const policy = { ...reference.sampling, minimumSamples: 16, maximumSamples: 16 };
type ReferenceContext = BenchmarkMeasureContext<Readonly<Record<string, never>>>;
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
function referenceExecution(input: CalibrationSamplingInput, executionId: string): CalibrationSamplingInput {
    const environment = input.scope.benchmarkEnvironment;
    if (environment === null) {
        throw new Error('Expected a calibration environment.');
    }
    const { normalization } = environment;
    if (normalization === null) {
        throw new Error('Expected a calibration environment.');
    }
    return {
        ...input,
        scope: {
            ...input.scope,
            benchmarkEnvironment: {
                ...environment,
                normalization: { ...structuredClone(normalization), executionId }
            }
        }
    };
}
export const testNode = suite('calibration sampling lifetimes', [
    test('reads historical normalization contexts without an execution ID', function (scope: TestScope) {
        const environment = calibrationScope(reference, scope.cleanup, scope.signal).benchmarkEnvironment;
        scope.require.defined(environment);
        const { normalization } = environment;
        scope.require.defined(normalization);
        Reflect.deleteProperty(normalization, 'executionId');
        const restored = benchmarkNormalizationContextSchema.parse(normalization);
        scope.assert.equal(restored.executionId, null);
        return scope.assert.collect();
    }),
    test(
        'reuses calibration across worker messages and refreshes it for a new execution',
        async function (scope) {
            let samples = 0;
            const sampler = createCalibrationSampler(reference.identity);
            const input = referenceExecution(
                samplingInput(calibrationScope(reference, scope.cleanup, scope.signal), function measured(context) {
                    samples += 1;
                    return measuredReference(context);
                }, 128),
                'first-run'
            );
            const first = await sampler.sample(input);
            scope.assert.equal(await sampler.sample(referenceExecution(input, 'first-run')), first);
            scope.assert.equal(samples, 128);
            await sampler.sample(referenceExecution(input, 'next-run'));
            scope.assert.equal(samples, 256);
            return scope.assert.collect();
        }
    ),
    test(
        'caches reference samples within a context and refreshes them for a new run',
        async function (scope) {
            let samples = 0;
            const sampler = createCalibrationSampler(reference.identity);
            const input = samplingInput(
                calibrationScope(reference, scope.cleanup, scope.signal),
                function measured(context) {
                    samples += 1;
                    return measuredReference(context);
                },
                128
            );
            const first = await sampler.sample(input);
            scope.assert.equal(await sampler.sample({ ...input }), first);
            scope.assert.equal(samples, 128);
            await sampler.sample({ ...input, scope: calibrationScope(reference, scope.cleanup, scope.signal) });
            scope.assert.equal(samples, 256);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'requires execution and normalization context',
        cases: [ false, true ],
        caseTitle(missingEnvironment) {
            return missingEnvironment ? 'execution environment' : 'normalization context';
        },
        async test(scope) {
            const missingEnvironment = scope.parameters;

            const original = calibrationScope(reference, scope.cleanup, scope.signal);
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
    }),
    test(
        'excludes warmup readings and cleans up every calibration invocation',
        async function (scope) {
            let calls = 0;
            let cleaned = 0;
            const input = samplingInput(
                calibrationScope(reference, scope.cleanup, scope.signal),
                function collectReference(context: ReferenceContext) {
                    calls += 1;
                    context.sample.cleanup(function () {
                        cleaned += 1;
                    });
                    return measuredReference(context);
                },
                16
            );
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
        }
    ),
    test(
        'stops with retained samples when the precision limit is exhausted',
        async function (scope) {
            scope.assert.deepEqual(
                await sampleCalibration(
                    reference.identity,
                    samplingInput(calibrationScope(reference, scope.cleanup, scope.signal), measuredReference, 2)
                ),
                {
                    kind: 'non-comparable',
                    reason: 'Calibration sampling limit reached before reference precision.',
                    samples: [ 200, 200 ]
                }
            );
            return scope.assert.collect();
        }
    ),
    table({
        title: 'retains measured evidence after sampling failure',
        cases: [ 0, 2 ],
        caseTitle(warmupSamples) {
            return warmupSamples === 0 ? 'measurement' : 'warmup';
        },
        async test(scope) {
            const warmupSamples = scope.parameters;

            let calls = 0;
            let cleaned = 0;
            const input = samplingInput(
                calibrationScope(reference, scope.cleanup, scope.signal),
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
    }),
    test('honors cancellation before taking a reference sample', async function (scope) {
        const controller = new AbortController();
        const input = samplingInput(
            { ...calibrationScope(reference, scope.cleanup, scope.signal), signal: controller.signal },
            measuredReference,
            16
        );
        controller.abort('calibration cancelled');
        scope.assert.deepEqual(await sampleCalibration(reference.identity, input), {
            kind: 'non-comparable',
            reason: 'calibration cancelled',
            samples: []
        });
        return scope.assert.collect();
    }),
    test('disposes process sessions when a reference callback fails', async function (scope) {
        const controller = new AbortController();
        const input = samplingInput(
            { ...calibrationScope(reference, scope.cleanup, scope.signal), signal: controller.signal },
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
    test('rejects unavailable requested garbage collection before sampling', async function (scope) {
        const input = samplingInput(calibrationScope(reference, scope.cleanup, scope.signal), measuredReference, 16);
        scope.assert.deepEqual(
            await sampleCalibration(reference.identity, {
                ...input,
                lifecycle: { ...input.lifecycle, garbageCollection: 'after-sample' }
            }),
            { kind: 'non-comparable', reason: 'GC unavailable', samples: [] }
        );
        return scope.assert.collect();
    }),
    test('retains non-Error cancellation reasons from calibration sessions', async function (scope) {
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
        const failure = await captureRejectedError(async function () {
            return await collectBenchmarkNormalization(
                {
                    ...calibrationScope(reference, scope.cleanup, scope.signal),
                    async updateResult(result) {
                        retained.push(result);
                    }
                },
                handles,
                rules,
                policy
            );
        });
        scope.assert.equal(failure.message, 'reference cancelled');
        scope.assert.deepEqual(
            retained.map(function (result) {
                return { status: result.status, comparability: result.normalization?.comparability };
            }),
            [ { status: 'incomplete', comparability: { kind: 'non-comparable', reason: 'reference cancelled' } } ]
        );
        return scope.assert.collect();
    }),
    table({
        title: 'retains calibration evidence after losing runner context',
        cases: [ false, true ],
        caseTitle(cached) {
            return cached ? 'cached' : 'new';
        },
        async test(scope) {
            const calibration = referenceResource();
            const rules = { value: { calibration, scaling: 'proportional' as const } };
            await using resources = await startResources({ resources: { calibration }, signal: scope.signal });
            const handles = { [calibrationResourceKey(rules.value)]: resources.context.calibration };
            if (scope.parameters) {
                await collectBenchmarkNormalization(
                    calibrationScope(reference, scope.cleanup, scope.signal),
                    handles,
                    rules,
                    policy
                );
            }
            const retained: BenchmarkExecutionResult[] = [];
            const failure = await captureRejectedError(async function () {
                return await collectBenchmarkNormalization(
                    {
                        ...calibrationScope(reference, scope.cleanup, scope.signal),
                        benchmarkEnvironment: null,
                        async updateResult(result) {
                            retained.push(result);
                        }
                    },
                    handles,
                    rules,
                    policy
                );
            });
            scope.assert.equal(
                failure.message,
                scope.parameters
                    ? 'Normalization requires a benchmark runner reference context.'
                    : 'Calibration requires a benchmark runner reference context.'
            );
            scope.assert.deepEqual(
                retained.map(function (result) {
                    return { status: result.status, samples: result.normalization?.calibrations.length };
                }),
                [
                    { status: 'incomplete', samples: scope.parameters ? 1 : 0 }
                ]
            );
            return scope.assert.collect();
        }
    })
]);
