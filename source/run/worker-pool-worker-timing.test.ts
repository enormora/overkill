import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RunTimingSpan } from '../engine/run-timings.ts';
import {
    createDeterministicOverkillClock,
    type DeterministicOverkillClock
} from '../clock/overkill-clock.ts';
import type { WorkerPoolTask } from './worker-pool-protocol.ts';
import {
    createWorkerResourceLifecycleTiming,
    measureWorkerSpan,
    postWorkerTimingSpan
} from './worker-pool-worker-timing.ts';

type TimingMessage = {
    readonly kind: 'timing';
    readonly span: RunTimingSpan;
};

type TimingTaskFixture = {
    readonly messages: readonly TimingMessage[];
    readonly task: WorkerPoolTask;
};

function createTimingTaskFixture(kind: 'collect' | 'run'): TimingTaskFixture {
    const messages: TimingMessage[] = [];
    const task = {
        kind,
        lane: kind === 'run' ? 'lane-1' : undefined,
        port: {
            postMessage(message: TimingMessage) {
                messages.push(message);
            }
        }
    } as unknown as WorkerPoolTask;

    return { messages, task };
}

async function captureMeasuredFailure(
    task: WorkerPoolTask,
    clock: DeterministicOverkillClock,
    error: Error
): Promise<unknown> {
    try {
        await measureWorkerSpan(
            task,
            clock,
            'worker.assign-work',
            async function measureFailedWork() {
                clock.advanceByMicroseconds(30);
                throw error;
            }
        );
    } catch (caughtError: unknown) {
        return caughtError;
    }

    return null;
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-worker-timing.test.ts',
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'postWorkerTimingSpan() records worker identity and clamps durations',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const fixture = createTimingTaskFixture('run');

                postWorkerTimingSpan({
                    completedAtMicroseconds: 10,
                    kind: 'worker.assign-work',
                    startedAtMicroseconds: 20,
                    status: 'success',
                    task: fixture.task
                });

                scope.assert.deepEqual(
                    fixture.messages.map(function toSpan(message) {
                        return message.span;
                    }),
                    [
                        {
                            durationMicroseconds: 0,
                            kind: 'worker.assign-work',
                            label: null,
                            processId: String(process.pid),
                            resource: null,
                            startOffsetMicroseconds: null,
                            status: 'success',
                            workerId: 'lane-1'
                        }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'measureWorkerSpan() records successful work',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createTimingTaskFixture('collect');
                const clock = createDeterministicOverkillClock();
                const value = await measureWorkerSpan(
                    fixture.task,
                    clock,
                    'worker.import-startup',
                    async function measureSuccessfulWork() {
                        clock.advanceByMicroseconds(25);

                        return 'ok';
                    }
                );

                scope.assert.equal(value, 'ok');
                scope.assert.equal(fixture.messages[0]?.span.status, 'success');
                scope.assert.equal(fixture.messages[0]?.span.durationMicroseconds, 25);
                scope.assert.equal(fixture.messages[0]?.span.workerId, null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'measureWorkerSpan() records failed work before rethrowing',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createTimingTaskFixture('run');
                const clock = createDeterministicOverkillClock();
                const error = new Error('worker failed');
                const thrownError = await captureMeasuredFailure(fixture.task, clock, error);

                scope.assert.equal(thrownError, error);
                scope.assert.equal(fixture.messages[0]?.span.status, 'failure');
                scope.assert.equal(fixture.messages[0]?.span.durationMicroseconds, 30);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker resource timing records resource and worker identity',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createTimingTaskFixture('run');
                const clock = createDeterministicOverkillClock();
                const timing = createWorkerResourceLifecycleTiming(fixture.task, clock);
                const controller = new AbortController();

                await timing.measure({
                    phase: 'dispose',
                    resource: { name: 'database', scope: 'shared-per-worker' },
                    signal: controller.signal
                }, async function disposeResource() {
                    clock.advanceByMicroseconds(17);
                });

                const [ message ] = fixture.messages;

                scope.require.defined(message);
                scope.assert.deepEqual(message.span, {
                    durationMicroseconds: 17,
                    kind: 'resource.dispose',
                    label: null,
                    processId: String(process.pid),
                    resource: { name: 'database', scope: 'shared-per-worker' },
                    startOffsetMicroseconds: null,
                    status: 'success',
                    workerId: 'lane-1'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker resource timing omits worker identity during collection',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createTimingTaskFixture('collect');
                const clock = createDeterministicOverkillClock();
                const timing = createWorkerResourceLifecycleTiming(fixture.task, clock);
                const controller = new AbortController();

                await timing.measure({
                    phase: 'acquire',
                    resource: { name: 'database', scope: 'per-run' },
                    signal: controller.signal
                }, async function acquireResource() {
                    clock.advanceByMicroseconds(9);
                });

                scope.assert.equal(fixture.messages[0]?.span.workerId, null);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
