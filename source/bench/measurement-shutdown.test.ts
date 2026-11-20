import { type TestNode, suite, test } from '@overkill-dev/test';

import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';

import { createMeasurementDeadline, type MeasurementShutdown } from './measurement-shutdown.ts';

type ShutdownFixture = {
    readonly clock: DeterministicClock;
    readonly deadline: MeasurementShutdown;
    readonly operation: ReturnType<typeof Promise.withResolvers<undefined>>;
    readonly pending: Promise<void>;
    readonly finish: () => void;
};
function shutdownFixture(): ShutdownFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const deadline = createMeasurementDeadline(clock, 2000);
    const operation = Promise.withResolvers<undefined>();
    return {
        clock,
        deadline,
        operation,
        pending: deadline.run(async function finalizeCollector() {
            await operation.promise;
        }),
        finish() {
            operation.resolve(undefined);
            deadline.close();
        }
    };
}
export const testNode: TestNode = suite('bounded measurement shutdown', [
    test('uses one deadline across asynchronous shutdown operations', async function (scope) {
        const fixture = shutdownFixture();
        fixture.clock.advanceByMilliseconds(1999);
        scope.assert.false(fixture.deadline.signal.aborted);
        fixture.clock.advanceByMilliseconds(1);
        await scope.assert.rejects(async function () {
            await fixture.pending;
        }, { message: 'Measurement shutdown deadline exceeded.' });
        fixture.finish();
        return scope.assert.collect();
    }),
    test('rejects synchronous shutdown that runs beyond the deadline', function (scope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const deadline = createMeasurementDeadline(clock, 2000);
        scope.assert.throws(function () {
            deadline.perform(function finalizeCollector() {
                clock.advanceByMilliseconds(2000);
            });
        }, { message: 'Measurement shutdown deadline exceeded.' });
        deadline.close();
        return scope.assert.collect();
    }),
    test('closing interrupts pending shutdown and leaves late operations fenced', async function (scope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const deadline = createMeasurementDeadline(clock, 2000);
        const operation = Promise.withResolvers<undefined>();
        const pending = deadline.run(async function finalizeCollector() {
            await operation.promise;
        });
        deadline.close();
        await scope.assert.rejects(async function () {
            await pending;
        }, { message: 'Measurement lifetime closed.' });
        operation.resolve(undefined);
        scope.assert.throws(deadline.check, { message: 'Measurement lifetime closed.' });
        return scope.assert.collect();
    })
]);
