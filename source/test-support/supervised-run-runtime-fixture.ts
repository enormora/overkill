import type { SupervisedChildProcess } from '../run/supervised-child-process.ts';
import { createStoredRunValue, createSupervisedRunState } from '../run/supervised-run-state.ts';
import type { SupervisedRunRuntime, SupervisedRunRuntimeSeed } from '../run/supervised-run-runtime.ts';

type ChildState = {
    readonly exitCode: number | null;
    readonly pid: number | undefined;
    readonly signalCode: string | null;
};

export type ChildRecord = {
    readonly child: SupervisedChildProcess;
    readonly signals: () => readonly string[];
};

export type TimeoutRuntimeRecord = {
    readonly advanceTo: (microseconds: number) => void;
    readonly callbacks: () => readonly (() => void)[];
    readonly clears: () => number;
    readonly delays: () => readonly number[];
    readonly runtime: SupervisedRunRuntimeSeed;
};

export function childProcess(state: ChildState): ChildRecord {
    const signals: string[] = [];

    return {
        child: {
            exitCode: state.exitCode,
            kill(signal: string) {
                signals.push(signal);
                return true;
            },
            pid: state.pid,
            signalCode: state.signalCode
        } as unknown as SupervisedChildProcess,
        signals() {
            return signals;
        }
    };
}

export function timeoutRuntime(child: SupervisedChildProcess): TimeoutRuntimeRecord {
    const callbacks: (() => void)[] = [];
    const delays: number[] = [];
    const reports: Promise<void>[] = [];
    let clears = 0;
    let currentMonotonicMicroseconds = 0;

    return {
        advanceTo(microseconds) {
            currentMonotonicMicroseconds = microseconds;
        },
        callbacks() {
            return callbacks;
        },
        clears() {
            return clears;
        },
        delays() {
            return delays;
        },
        runtime: {
            child,
            collectedPlan: createStoredRunValue(null),
            completedResult: createStoredRunValue(null),
            dependencies: {
                wallClock: {
                    clearTimeout(timeout: unknown) {
                        clears += timeout === null ? 0 : 1;
                    },
                    currentUnixEpochMilliseconds: 0,
                    get currentMonotonicMicroseconds() {
                        return BigInt(currentMonotonicMicroseconds);
                    },
                    setTimeout(callback: () => void, delay: number) {
                        callbacks.push(callback);
                        delays.push(delay);
                        return callbacks.length;
                    }
                },
                reporterDispatcher: {}
            },
            previousSample: createStoredRunValue(null),
            reporterContext: { outputRenderer: { render: String }, reporters: [] },
            reporterEvents: {
                add(eventReport: Promise<void>) {
                    reports.push(eventReport);
                },
                async wait() {
                    await Promise.all(reports);
                }
            },
            resolvedRun: {
                facts: {
                    execution: {
                        processUsagePolicy: {
                            budgets: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            }
                        },
                        timeoutPolicy: { hardMilliseconds: 1000 }
                    }
                }
            },
            state: createSupervisedRunState('first-failure-and-final'),
            terminalFailure: createStoredRunValue(false)
        } as unknown as SupervisedRunRuntimeSeed
    };
}

export function runRuntime(seed: SupervisedRunRuntimeSeed): SupervisedRunRuntime {
    return {
        ...seed,
        timeout: {
            clear() {
                return undefined;
            },
            start() {
                return undefined;
            }
        }
    };
}

export function runningSupervisedRuntime(): SupervisedRunRuntime {
    return runRuntime(timeoutRuntime(childProcess({ exitCode: null, pid: 1, signalCode: null }).child).runtime);
}
