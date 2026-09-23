import { performance as nodePerformance } from 'node:perf_hooks';
import {
    clearInterval as clearNodeInterval,
    clearTimeout as clearNodeTimeout,
    setInterval as setNodeInterval,
    setTimeout as setNodeTimeout
} from 'node:timers';

const microsecondsPerMillisecond = 1000;

type DeterministicTimerIdentifier = { readonly id: number; readonly source: 'deterministic'; };
type PlatformTimerIdentifier = { readonly id: number; readonly source: 'platform'; };
type PlatformIntervalIdentifier = { readonly id: number; readonly source: 'platform'; };
type TimerIdentifier = DeterministicTimerIdentifier | PlatformTimerIdentifier;
type IntervalIdentifier = DeterministicTimerIdentifier | PlatformIntervalIdentifier;

export type OverkillClock = {
    readonly clearInterval: (identifier: IntervalIdentifier) => void;
    readonly clearTimeout: (identifier: TimerIdentifier) => void;
    readonly currentEpochMilliseconds: number;
    readonly currentMonotonicMicroseconds: number;
    readonly setInterval: (callback: () => void, delayMilliseconds: number) => IntervalIdentifier;
    readonly setTimeout: (callback: () => void, delayMilliseconds: number) => TimerIdentifier;
};

type DeterministicTimerKind = 'interval' | 'timeout';

type DeterministicTimer = {
    readonly callback: () => void;
    readonly delayMicroseconds: number;
    readonly dueAtMicroseconds: number;
    readonly id: number;
    readonly kind: DeterministicTimerKind;
};

export type DeterministicOverkillClock = OverkillClock & {
    readonly advanceByMicroseconds: (microseconds: number) => void;
    readonly advanceByMilliseconds: (milliseconds: number) => void;
};

function delayMicroseconds(delayMilliseconds: number): number {
    return Math.max(0, Math.trunc(delayMilliseconds * microsecondsPerMillisecond));
}

export function createOverkillClock(): OverkillClock {
    const intervals = new Map<number, ReturnType<typeof setNodeInterval>>();
    const timers = new Map<number, ReturnType<typeof setNodeTimeout>>();
    let nextIdentifier = 0;

    return {
        clearInterval(identifier) {
            if (identifier.source === 'platform') {
                const interval = intervals.get(identifier.id);

                if (interval !== undefined) {
                    clearNodeInterval(interval);
                    intervals.delete(identifier.id);
                }
            }
        },
        clearTimeout(identifier) {
            if (identifier.source === 'platform') {
                const timer = timers.get(identifier.id);

                if (timer !== undefined) {
                    clearNodeTimeout(timer);
                    timers.delete(identifier.id);
                }
            }
        },
        get currentEpochMilliseconds() {
            return Date.now();
        },
        get currentMonotonicMicroseconds() {
            return Math.trunc(nodePerformance.now() * microsecondsPerMillisecond);
        },
        setInterval(callback, delayMilliseconds) {
            const id = nextIdentifier;
            nextIdentifier += 1;
            intervals.set(id, setNodeInterval(callback, delayMilliseconds));

            return { id, source: 'platform' };
        },
        setTimeout(callback, delayMilliseconds) {
            const id = nextIdentifier;
            nextIdentifier += 1;
            const timer = setNodeTimeout(function runTimer() {
                timers.delete(id);
                callback();
            }, delayMilliseconds);
            timers.set(id, timer);

            return { id, source: 'platform' };
        }
    };
}

function nextDueTimer(timers: ReadonlyMap<number, DeterministicTimer>): DeterministicTimer | null {
    let selected: DeterministicTimer | null = null;

    for (const timer of timers.values()) {
        if (
            selected === null ||
            timer.dueAtMicroseconds < selected.dueAtMicroseconds ||
            timer.dueAtMicroseconds === selected.dueAtMicroseconds && timer.id < selected.id
        ) {
            selected = timer;
        }
    }

    return selected;
}

export function createDeterministicOverkillClock(): DeterministicOverkillClock {
    const timers = new Map<number, DeterministicTimer>();
    let nowMicroseconds = 0;
    let nextTimerId = 0;

    const runDueTimers = function runDueTimers(): void {
        let timer = nextDueTimer(timers);

        while (timer !== null && timer.dueAtMicroseconds <= nowMicroseconds) {
            if (timer.kind === 'timeout') {
                timers.delete(timer.id);
            } else {
                timers.set(timer.id, {
                    ...timer,
                    dueAtMicroseconds: timer.dueAtMicroseconds + timer.delayMicroseconds
                });
            }

            timer.callback();
            timer = nextDueTimer(timers);
        }
    };

    const setTimer = function setTimer(
        kind: DeterministicTimerKind,
        callback: () => void,
        delayMilliseconds: number
    ): DeterministicTimerIdentifier {
        const id = nextTimerId;
        const delay = kind === 'interval'
            ? Math.max(1, delayMicroseconds(delayMilliseconds))
            : delayMicroseconds(delayMilliseconds);
        nextTimerId += 1;
        timers.set(id, {
            callback,
            delayMicroseconds: delay,
            dueAtMicroseconds: nowMicroseconds + delay,
            id,
            kind
        });

        return { id, source: 'deterministic' };
    };

    const advanceByMicroseconds = function advanceByMicroseconds(microseconds: number): void {
        nowMicroseconds += Math.max(0, Math.trunc(microseconds));
        runDueTimers();
    };

    return {
        advanceByMicroseconds,
        advanceByMilliseconds(milliseconds) {
            advanceByMicroseconds(milliseconds * microsecondsPerMillisecond);
        },
        clearInterval(identifier) {
            if (identifier.source === 'deterministic') {
                timers.delete(identifier.id);
            }
        },
        clearTimeout(identifier) {
            if (identifier.source === 'deterministic') {
                timers.delete(identifier.id);
            }
        },
        get currentEpochMilliseconds() {
            return Math.trunc(nowMicroseconds / microsecondsPerMillisecond);
        },
        get currentMonotonicMicroseconds() {
            return nowMicroseconds;
        },
        setInterval(callback, delayMilliseconds) {
            return setTimer('interval', callback, delayMilliseconds);
        },
        setTimeout(callback, delayMilliseconds) {
            return setTimer('timeout', callback, delayMilliseconds);
        }
    };
}
