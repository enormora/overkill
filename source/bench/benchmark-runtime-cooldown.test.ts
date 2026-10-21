import { mock, type Mock } from 'node:test';
import { createDeterministicClock, type Clock, type DeterministicClock } from '@enormora/clock';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defaultRuntimeCooldownPolicy } from '../packages/bench/bench.entry-point.ts';
import type { BenchmarkCooldownResult } from '../engine/benchmark-result.ts';
import { settleBenchmarkRuntime, type RuntimeCooldownOutcome } from './benchmark-runtime-cooldown.ts';

const caseId = { file: 'cooldown.bench.ts', suite: [], title: 'cooldown', params: null };
const workId = { case: caseId, workload: null, runtimes: [] };

const initial: Extract<BenchmarkCooldownResult, { readonly mode: 'runtime'; }> = {
    mode: 'runtime',
    strategy: 'event-loop-utilization-v1',
    completed: 0,
    windows: 0,
    durationMicroseconds: 0,
    lastUtilization: null,
    outcome: 'pending'
};

type CooldownFixture = {
    readonly clock: DeterministicClock;
    readonly controller: AbortController;
    readonly pending: Promise<RuntimeCooldownOutcome>;
    readonly cleared: Mock<Clock['clearTimeout']>;
    readonly scheduled: Mock<Clock['setTimeout']>;
    readonly observations: () => number;
};

function startCooldown(readings: readonly number[], earlyMilliseconds: number): CooldownFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const controller = new AbortController();
    const cleared = mock.method(clock, 'clearTimeout');
    const schedule = clock.setTimeout;
    const earlyTimer: Clock['setTimeout'] = function scheduleBeforeDeadline(handler, delay, ...handlerArguments) {
        return schedule(handler, Math.max(0, delay - earlyMilliseconds), ...handlerArguments);
    };
    const scheduled = mock.method(clock, 'setTimeout', earlyTimer);
    let index = 0;
    const pending = settleBenchmarkRuntime(defaultRuntimeCooldownPolicy, controller.signal, initial, {
        clock,
        beginWindow() {
            return function readNextWindow() {
                const reading = readings[index] ?? 1;
                index += 1;
                return reading;
            };
        }
    });
    return {
        clock,
        controller,
        pending,
        cleared,
        scheduled,
        observations() {
            return index;
        }
    };
}

async function completeObservationWindow(
    scope: TestScope,
    cooldown: CooldownFixture,
    completed: number
): Promise<void> {
    cooldown.clock.advanceByMilliseconds(49);
    await scope.settleAsyncWork();
    scope.assert.equal(cooldown.observations(), completed);
    cooldown.clock.advanceByMilliseconds(1);
    await scope.settleAsyncWork();
}

export const testNode = suite('bounded runtime cooldown', [
    test('requires consecutive quiet windows and accepts threshold equality', async function (scope) {
        const cooldown = startCooldown([ 0.1, 0.8, 0.1, 0.1 ], 0);
        scope.cleanup(function () {
            cooldown.controller.abort();
        });
        for (let index = 0; index < 4; index += 1) {
            cooldown.clock.advanceByMilliseconds(50);
            await scope.settleAsyncWork();
        }
        const result = await cooldown.pending;
        scope.assert.equal(result.error, null);
        scope.assert.partialDeepEqual(result.evidence, {
            completed: 1,
            windows: 4,
            lastUtilization: 0.1,
            outcome: 'settled',
            durationMicroseconds: 200_000
        });
        scope.assert.deepEqual(
            cooldown.cleared.mock.calls.map((call) => {
                return call.arguments[0];
            }),
            [ cooldown.scheduled.mock.calls[0]?.result ]
        );
        return scope.assert.collect();
    }),
    test('stops at the hard cooldown cap and clears the pending observation timer', async function (scope) {
        const cooldown = startCooldown([ 1 ], 0);
        cooldown.clock.advanceByMilliseconds(975);
        await scope.settleAsyncWork();
        cooldown.clock.advanceByMilliseconds(25);
        const result = await cooldown.pending;
        scope.assert.partialDeepEqual(result.evidence, {
            outcome: 'timed-out',
            completed: 0,
            durationMicroseconds: 1_000_000
        });
        scope.assert.equal(result.error?.runnerError(caseId, workId).subtype, 'measurement');
        scope.assert.equal(cooldown.cleared.mock.calls.length, 2);
        return scope.assert.collect();
    }),
    test('cancels promptly and clears both owned timers', async function (scope) {
        const cooldown = startCooldown([ 0 ], 0);
        cooldown.controller.abort(new Error('case cancelled'));
        const result = await cooldown.pending;
        scope.assert.equal(result.evidence.outcome, 'cancelled');
        scope.assert.equal(result.evidence.windows, 0);
        scope.assert.equal(cooldown.cleared.mock.calls.length, 2);
        return scope.assert.collect();
    }),
    test('records unavailable observations without retaining invalid numeric evidence', async function (scope) {
        const cooldown = startCooldown([ Number.NaN ], 0);
        cooldown.clock.advanceByMilliseconds(50);
        const result = await cooldown.pending;
        scope.assert.equal(result.evidence.outcome, 'unavailable');
        scope.assert.equal(result.evidence.lastUtilization, null);
        scope.assert.equal(result.error?.runnerError(caseId, workId).subtype, 'measurement');
        return scope.assert.collect();
    }),
    test('completes full observation windows when timer callbacks arrive early', async function (scope) {
        const cooldown = startCooldown([ 0, 0 ], 1);
        scope.cleanup(function cancelPendingObservation() {
            cooldown.controller.abort();
        });
        for (const completed of [ 0, 1 ]) {
            await completeObservationWindow(scope, cooldown, completed);
        }
        const result = await cooldown.pending;
        scope.assert.equal(result.error, null);
        scope.assert.partialDeepEqual(result.evidence, {
            completed: 1,
            windows: 2,
            outcome: 'settled',
            durationMicroseconds: 100_000
        });
        return scope.assert.collect();
    })
]);
