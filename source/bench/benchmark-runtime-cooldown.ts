import { performance as runtimePerformance } from 'node:perf_hooks';
import { createClock, type Clock } from '@enormora/clock';
import type { BenchmarkCooldownPolicy, BenchmarkCooldownResult } from '../engine/benchmark-result.ts';
import { CaseRunnerError } from '../engine/run-result.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { runtimeCooldownQuietWindows, runtimeCooldownWindowMilliseconds } from './benchmark-lifecycle-policy.ts';

type RuntimeCooldownPolicy = Extract<BenchmarkCooldownPolicy, { readonly mode: 'runtime'; }>;
type RuntimeCooldownResult = Extract<BenchmarkCooldownResult, { readonly mode: 'runtime'; }>;
export type RuntimeCooldownOutcome = {
    readonly evidence: RuntimeCooldownResult;
    readonly error: CaseRunnerError | null;
};
export type RuntimeCooldownDependencies = {
    readonly clock: Clock;
    readonly beginWindow: () => () => number;
};
type CooldownDeadline = {
    readonly close: () => void;
    readonly signal: AbortSignal;
    readonly check: () => void;
    readonly outcome: () => RuntimeCooldownResult['outcome'];
};
type RuntimeWindow = { readonly quiet: number; readonly windows: number; readonly lastUtilization: number | null; };
type RuntimeSettling = {
    readonly deadline: CooldownDeadline;
    readonly dependencies: RuntimeCooldownDependencies;
    readonly policy: RuntimeCooldownPolicy;
    readonly window: StoredValue<RuntimeWindow>;
};
const microsecondsPerMillisecond = 1000;

export function createRuntimeCooldownDependencies(): RuntimeCooldownDependencies {
    return {
        clock: createClock(),
        beginWindow() {
            const before = runtimePerformance.eventLoopUtilization();
            return function utilizationSinceWindowStart() {
                return runtimePerformance.eventLoopUtilization(before).utilization;
            };
        }
    };
}

async function waitForWindow(clock: Clock, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const pending = Promise.withResolvers<undefined>();
    const timer = createStoredValue<ReturnType<Clock['setTimeout']> | null>(null);
    const abort = function abortWindow(): void {
        const pendingTimer = timer.read();
        if (pendingTimer !== null) {
            clock.clearTimeout(pendingTimer);
        }
        pending.reject(new Error('Runtime cooldown observation cancelled.', { cause: signal.reason }));
    };
    timer.write(clock.setTimeout(function finishWindow() {
        signal.removeEventListener('abort', abort);
        pending.resolve(undefined);
    }, runtimeCooldownWindowMilliseconds));
    signal.addEventListener('abort', abort, { once: true });
    await pending.promise;
}

function createCooldownDeadline(policy: RuntimeCooldownPolicy, signal: AbortSignal, clock: Clock): CooldownDeadline {
    const controller = new AbortController();
    const expires = clock.currentMonotonicMicroseconds +
        BigInt(policy.timeoutMilliseconds * microsecondsPerMillisecond);
    const expire = function expireCooldown(): void {
        controller.abort(new Error('Runtime cooldown deadline exceeded.'));
    };
    const combined = AbortSignal.any([ signal, controller.signal ]);
    const timer = clock.setTimeout(expire, policy.timeoutMilliseconds);
    return {
        signal: combined,
        check() {
            if (clock.currentMonotonicMicroseconds >= expires) {
                expire();
            }
            combined.throwIfAborted();
        },
        outcome() {
            if (signal.aborted) {
                return 'cancelled';
            }
            return controller.signal.aborted ? 'timed-out' : 'unavailable';
        },
        close() {
            clock.clearTimeout(timer);
        }
    };
}

async function observeRuntimeWindow(input: RuntimeSettling): Promise<void> {
    input.deadline.check();
    const readUtilization = input.dependencies.beginWindow();
    await waitForWindow(input.dependencies.clock, input.deadline.signal);
    input.deadline.check();
    const utilization = readUtilization();
    if (!Number.isFinite(utilization) || utilization < 0 || utilization > 1) {
        throw new RangeError('Runtime event-loop utilization is unavailable.');
    }
    const previous = input.window.read();
    input.window.write({
        windows: previous.windows + 1,
        lastUtilization: utilization,
        quiet: utilization <= input.policy.maximumEventLoopUtilization ? previous.quiet + 1 : 0
    });
}

async function collectQuietWindows(input: RuntimeSettling): Promise<void> {
    while (input.window.read().quiet < runtimeCooldownQuietWindows) {
        await observeRuntimeWindow(input);
    }
}

function cooldownEvidence(
    previous: RuntimeCooldownResult,
    window: RuntimeWindow,
    elapsed: number,
    outcome: RuntimeCooldownResult['outcome']
): RuntimeCooldownResult {
    return {
        ...previous,
        completed: previous.completed + (outcome === 'settled' ? 1 : 0),
        windows: previous.windows + window.windows,
        durationMicroseconds: previous.durationMicroseconds + elapsed,
        lastUtilization: window.lastUtilization,
        outcome
    };
}

type RuntimeSettlingOutcome = {
    readonly outcome: RuntimeCooldownResult['outcome'];
    readonly error: CaseRunnerError | null;
};

async function attemptRuntimeSettling(input: RuntimeSettling): Promise<RuntimeSettlingOutcome> {
    try {
        await collectQuietWindows(input);
        return { outcome: 'settled', error: null };
    } catch (error: unknown) {
        const outcome = input.deadline.outcome();
        return {
            outcome,
            error: new CaseRunnerError(`Benchmark runtime cooldown ${outcome}.`, {
                subtype: 'measurement',
                cause: error
            })
        };
    }
}

export async function settleBenchmarkRuntime(
    policy: RuntimeCooldownPolicy,
    signal: AbortSignal,
    previous: RuntimeCooldownResult,
    dependencies: RuntimeCooldownDependencies
): Promise<RuntimeCooldownOutcome> {
    const started = dependencies.clock.currentMonotonicMicroseconds;
    const deadline = createCooldownDeadline(policy, signal, dependencies.clock);
    const window = createStoredValue<RuntimeWindow>({ quiet: 0, windows: 0, lastUtilization: null });
    try {
        const completed = await attemptRuntimeSettling({ policy, deadline, window, dependencies });
        return {
            evidence: cooldownEvidence(
                previous,
                window.read(),
                Number(dependencies.clock.currentMonotonicMicroseconds - started),
                completed.outcome
            ),
            error: completed.error
        };
    } finally {
        deadline.close();
    }
}
