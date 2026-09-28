import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createDeterministicOverkillClock,
    type DeterministicOverkillClock
} from '../clock/overkill-clock.ts';
import { defineResource, type AnyResourceDefinition } from '../resources/resources.ts';
import type { RunTimingSpan } from '../engine/run-timings.ts';
import { acquireResourceWithStartupBudget } from './resource-lifecycle-startup-budget.ts';
import {
    createResourceLifecycleTiming,
    type ResourceLifecycleTiming,
    type ResourceLifecycleTimingOperation
} from './resource-lifecycle-timing.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

type LocalTimingFixture = {
    readonly spans: readonly RunTimingSpan[];
    readonly timing: ResourceLifecycleTiming;
};

type FailureObservations = {
    readonly cancellation: Error;
    readonly caughtCancellation: unknown;
    readonly caughtFailure: unknown;
    readonly failure: Error;
};

function operation(signal: AbortSignal): ResourceLifecycleTimingOperation {
    return {
        phase: 'acquire' as const,
        resource: { name: 'database', scope: 'per-run' as const },
        signal
    };
}

function localTiming(clock: DeterministicOverkillClock): LocalTimingFixture {
    const spans: RunTimingSpan[] = [];
    const timing = createResourceLifecycleTiming({
        clock,
        processId: 'process-1',
        target: {
            emit(span) {
                spans.push(span);
            },
            kind: 'local'
        },
        workerId: 'worker-1'
    });

    return { spans, timing };
}

async function capturedError(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error: unknown) {
        return error;
    }

    return null;
}

async function failureObservations(
    clock: DeterministicOverkillClock,
    timing: ResourceLifecycleTiming
): Promise<FailureObservations> {
    const failureController = new AbortController();
    const failure = new Error('acquire failed');
    const caughtFailure = await capturedError(async function failAcquisition() {
        await timing.measure(operation(failureController.signal), async function acquireResource() {
            clock.advanceByMicroseconds(12);
            throw failure;
        });
    });
    const cancellationController = new AbortController();
    const cancellation = new Error('cancelled');
    const caughtCancellation = await capturedError(async function cancelAcquisition() {
        await timing.measure(operation(cancellationController.signal), async function acquireResource() {
            clock.advanceByMicroseconds(8);
            cancellationController.abort(cancellation);
            throw cancellation;
        });
    });

    return { cancellation, caughtCancellation, caughtFailure, failure };
}

function timeoutResource(): AnyResourceDefinition {
    return defineResource({
        async acquire(context) {
            return await new Promise<never>(function waitForAbort(_resolve, reject) {
                context.signal.addEventListener('abort', function rejectAfterAbort() {
                    const reason: unknown = context.signal.reason;

                    reject(reason instanceof Error ? reason : new Error(String(reason)));
                }, { once: true });
            });
        },
        dependencies: {},
        deserializeHandle(payload) {
            return payload;
        },
        dispose: null,
        name: 'database',
        requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 0 } ],
        serializeHandle: String,
        scope: 'per-run'
    });
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/resource-lifecycle-timing.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource lifecycle timing records parent-relative resource spans',
            async body(scope: OverkillScope) {
                const clock = createDeterministicOverkillClock();
                const measurement = createRunTimingMeasurement(clock);
                const timing = createResourceLifecycleTiming({
                    clock,
                    processId: 'parent-process',
                    target: { kind: 'parent', record: measurement.record },
                    workerId: null
                });
                const controller = new AbortController();

                clock.advanceByMicroseconds(10);
                await timing.measure(operation(controller.signal), async function acquireResource() {
                    clock.advanceByMicroseconds(25);
                });

                const report = measurement.report();

                scope.assert.deepEqual(report.spans, [ {
                    durationMicroseconds: 25,
                    kind: 'resource.acquire',
                    label: null,
                    processId: 'parent-process',
                    resource: { name: 'database', scope: 'per-run' },
                    startOffsetMicroseconds: 10,
                    status: 'success',
                    workerId: null
                } ]);
                scope.assert.deepEqual(report.aggregates, [ {
                    count: 1,
                    durationMicroseconds: 25,
                    kind: 'resource.acquire'
                } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource lifecycle timing records local failures and cancellations',
            async body(scope: OverkillScope) {
                const clock = createDeterministicOverkillClock();
                const fixture = localTiming(clock);
                const observed = await failureObservations(clock, fixture.timing);

                scope.assert.equal(observed.caughtFailure, observed.failure);
                scope.assert.equal(observed.caughtCancellation, observed.cancellation);
                scope.assert.deepEqual(
                    fixture.spans.map(function timingStatus(span) {
                        return {
                            durationMicroseconds: span.durationMicroseconds,
                            processId: span.processId,
                            startOffsetMicroseconds: span.startOffsetMicroseconds,
                            status: span.status,
                            workerId: span.workerId
                        };
                    }),
                    [
                        {
                            durationMicroseconds: 12,
                            processId: 'process-1',
                            startOffsetMicroseconds: null,
                            status: 'failure',
                            workerId: 'worker-1'
                        },
                        {
                            durationMicroseconds: 8,
                            processId: 'process-1',
                            startOffsetMicroseconds: null,
                            status: 'cancelled',
                            workerId: 'worker-1'
                        }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource lifecycle timing distinguishes startup budget timeouts',
            async body(scope: OverkillScope) {
                const clock = createDeterministicOverkillClock();
                const fixture = localTiming(clock);
                const controller = new AbortController();

                await capturedError(async function timeoutAcquisition() {
                    await fixture.timing.measure(operation(controller.signal), async function acquireResource() {
                        return await acquireResourceWithStartupBudget(timeoutResource(), {
                            dependencies: {},
                            signal: controller.signal
                        });
                    });
                });

                scope.assert.equal(fixture.spans[0]?.status, 'timeout');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource lifecycle timing cannot change resource behavior',
            async body(scope: OverkillScope) {
                const clock = createDeterministicOverkillClock();
                const timing = createResourceLifecycleTiming({
                    clock,
                    processId: 'process-1',
                    target: {
                        emit() {
                            throw new Error('timing transport failed');
                        },
                        kind: 'local'
                    },
                    workerId: null
                });
                const controller = new AbortController();
                const value = await timing.measure(operation(controller.signal), async function acquireResource() {
                    return 'handle';
                });
                const failure = new Error('resource failed');
                const caughtFailure = await capturedError(async function failResource() {
                    await timing.measure(operation(controller.signal), async function acquireResource() {
                        throw failure;
                    });
                });

                scope.assert.equal(value, 'handle');
                scope.assert.equal(caughtFailure, failure);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
