import { doubleUsage, suite, test, testDouble, type TestDouble, type TestScope } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';

import { createDeterministicClock, type Clock, type DeterministicClock } from '@enormora/clock';
import { defaultRuntimeCooldownPolicy } from '../packages/bench/bench.entry-point.ts';
import type { BenchmarkCooldownResult } from '../engine/benchmark-result.ts';
import { settleBenchmarkRuntime, type RuntimeCooldownOutcome } from './benchmark-runtime-cooldown.ts';

const caseId = { file: 'cooldown.bench.ts', suite: [], title: 'cooldown', params: null };
const workId = { familyVariant: null, case: caseId, workload: null, runtimes: [] };

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
    readonly cleared: TestDouble<Clock['clearTimeout']>;
    readonly scheduled: TestDouble<Clock['setTimeout']>;
    readonly observations: () => number;
};

function startCooldown(readings: readonly number[], earlyMilliseconds: number): CooldownFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const controller = new AbortController();
    const { clearTimeout: cancelTimer, setTimeout: schedule } = clock;
    const cleared = testDouble<Clock['clearTimeout']>({
        answer({ arguments: args }) {
            cancelTimer(...args);
        }
    });
    const earlyTimer: Clock['setTimeout'] = function scheduleBeforeDeadline(handler, delay, ...handlerArguments) {
        return schedule(handler, Math.max(0, delay - earlyMilliseconds), ...handlerArguments);
    };
    const scheduled = testDouble<Clock['setTimeout']>({
        answer({ arguments: args }) {
            return earlyTimer(...args);
        }
    });
    let index = 0;
    const pending = settleBenchmarkRuntime(defaultRuntimeCooldownPolicy, controller.signal, initial, {
        clock: Object.assign(clock, { clearTimeout: cleared, setTimeout: scheduled }),
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

const clearsFirstTimer = defineCompositeAssertion({
    name: 'clears the first scheduled timer',
    assert(check, cooldown: CooldownFixture) {
        const timer = cooldown.scheduled.firstResult;
        if (timer?.status !== 'returned') {
            return check.equal(timer?.status, 'returned');
        }
        return check.deepEqual(
            cooldown.cleared.calls.map(function timerHandle(call) {
                return call.arguments[0];
            }),
            [ timer.value ]
        );
    }
});
async function observeEarlyTimerWindows(
    cooldown: CooldownFixture,
    settleAsyncWork: TestScope['settleAsyncWork']
): Promise<readonly number[]> {
    const observations = [];
    for (let window = 0; window < 2; window += 1) {
        cooldown.clock.advanceByMilliseconds(49);
        await settleAsyncWork();
        observations.push(cooldown.observations());
        cooldown.clock.advanceByMilliseconds(1);
        await settleAsyncWork();
    }
    return observations;
}

export const testNode = suite('bounded runtime cooldown', [
    test('requires consecutive quiet windows and accepts threshold equality', async function (scope) {
        const cooldown = startCooldown([ 0.1, 0.8, 0.1, 0.1 ], 0);

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
        scope.assert(clearsFirstTimer, cooldown);
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
        scope.assert(doubleUsage.callCount, cooldown.cleared, 2);
        return scope.assert.collect();
    }),
    test('cancels promptly and clears both owned timers', async function (scope) {
        const cooldown = startCooldown([ 0 ], 0);
        cooldown.controller.abort(new Error('case cancelled'));
        const result = await cooldown.pending;
        scope.assert.equal(result.evidence.outcome, 'cancelled');
        scope.assert.equal(result.evidence.windows, 0);
        scope.assert(doubleUsage.callCount, cooldown.cleared, 2);
        return scope.assert.collect();
    }),
    test(
        'records unavailable observations without retaining invalid numeric evidence',
        async function (scope) {
            const cooldown = startCooldown([ Number.NaN ], 0);
            cooldown.clock.advanceByMilliseconds(50);
            const result = await cooldown.pending;
            scope.assert.equal(result.evidence.outcome, 'unavailable');
            scope.assert.equal(result.evidence.lastUtilization, null);
            scope.assert.equal(result.error?.runnerError(caseId, workId).subtype, 'measurement');
            return scope.assert.collect();
        }
    ),
    test('completes full observation windows when timer callbacks arrive early', async function (scope) {
        const cooldown = startCooldown([ 0, 0 ], 1);

        scope.assert.deepEqual(await observeEarlyTimerWindows(cooldown, scope.settleAsyncWork), [ 0, 1 ]);
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
