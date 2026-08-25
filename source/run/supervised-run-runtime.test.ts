import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { CaseId } from '../engine/identity.ts';
import type { ResourceUsageSnapshot } from '../engine/run-result.ts';
import type { CollectedRunPlan, ResolvedRun } from './run-types.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import { createStoredRunValue, createSupervisedRunState } from './supervised-run-state.ts';
import {
    createHardTimeout,
    handleChildMessage,
    handleCollectionSample,
    kill,
    supervisedCollectedPlan,
    type SupervisedCollectionRuntime,
    type SupervisedHardTimeout,
    type SupervisedRunRuntime,
    type SupervisedRunRuntimeSeed
} from './supervised-run-runtime.ts';

type ChildState = {
    readonly exitCode: number | null;
    readonly pid: number | undefined;
    readonly signalCode: string | null;
};
type ChildRecord = {
    readonly child: SupervisedChildProcess;
    readonly signals: () => readonly string[];
};
type TimeoutRuntimeRecord = {
    readonly callbacks: () => readonly (() => void)[];
    readonly clears: () => number;
    readonly runtime: SupervisedRunRuntimeSeed;
};

const collectedPlan = { root: { name: 'root' } } as unknown as CollectedRunPlan;
const caseId: CaseId = {
    file: 'source/example.test.ts',
    name: 'case',
    params: null,
    suite: []
};
const resourceSample: ResourceUsageSnapshot = {
    activeResourceCount: 0,
    activeResourceTypes: [],
    capturedAtMilliseconds: 1000,
    javaScriptEngineHeapBytes: 100,
    residentSetBytes: 200
};

function resolvedRunWithPlan(plan: ResolvedRun['plan']): ResolvedRun {
    return { plan } as unknown as ResolvedRun;
}

function childProcess(state: ChildState): ChildRecord {
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

function timeoutRuntime(child: SupervisedChildProcess): TimeoutRuntimeRecord {
    const callbacks: (() => void)[] = [];
    const reports: Promise<void>[] = [];
    let clears = 0;

    return {
        callbacks() {
            return callbacks;
        },
        clears() {
            return clears;
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
                    currentTimestampInMilliseconds: 0,
                    setTimeout(callback: () => void) {
                        callbacks.push(callback);
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
                        resourceUsagePolicy: {
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
            state: createSupervisedRunState(),
            terminalFailure: createStoredRunValue(false)
        } as unknown as SupervisedRunRuntimeSeed
    };
}

function runRuntime(seed: SupervisedRunRuntimeSeed): SupervisedRunRuntime {
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

function collectionRuntime(
    child: SupervisedChildProcess,
    terminalFailure: boolean,
    activeResourceCount: number | null
): SupervisedCollectionRuntime<CollectedRunPlan | null> {
    return {
        child,
        collected: createStoredRunValue(null),
        command: {
            resourceBudgets: {
                activeResourceCount,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            }
        },
        dependencies: {},
        previousSample: createStoredRunValue(null),
        state: createSupervisedRunState(),
        terminalFailure: createStoredRunValue(terminalFailure)
    } as unknown as SupervisedCollectionRuntime<CollectedRunPlan | null>;
}

function timeoutCallback(scope: OverkillScope, callbacks: readonly (() => void)[]): () => void {
    const [ callback ] = callbacks;
    scope.require.defined(callback);

    return callback;
}

function startTimeoutForActiveCase(runtime: SupervisedRunRuntimeSeed): SupervisedHardTimeout {
    const timeout = createHardTimeout(runtime);

    timeout.start();
    runtime.state.addActiveCase('case', { id: caseId });
    timeout.start();
    timeout.start();

    return timeout;
}

export const testSuite = createOverkillSuite({
    name: 'source/run/supervised-run-runtime.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'supervisedCollectedPlan() accepts only supervised plans',
            metadata: {},
            body(scope: OverkillScope) {
                const supervisedPlan = { collectedPlan, kind: 'supervised' as const };
                const localPlan = { kind: 'local' as const, testPlan: {} };

                scope.assert.equal(
                    Object.is(
                        supervisedCollectedPlan(resolvedRunWithPlan(supervisedPlan)),
                        collectedPlan
                    ),
                    true
                );
                scope.assert.throws(function readLocalPlan() {
                    supervisedCollectedPlan(resolvedRunWithPlan(localPlan as ResolvedRun['plan']));
                }, { message: 'Supervised execution requires a supervised collected plan.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'kill() only signals a live spawned child',
            metadata: {},
            body(scope: OverkillScope) {
                const live = childProcess({ exitCode: null, pid: 1, signalCode: null });
                const exited = childProcess({ exitCode: 0, pid: 2, signalCode: null });
                const notStarted = childProcess({ exitCode: null, pid: undefined, signalCode: null });
                const signaled = childProcess({ exitCode: null, pid: 3, signalCode: 'SIGTERM' });

                kill(live.child);
                kill(exited.child);
                kill(notStarted.child);
                kill(signaled.child);

                scope.assert.deepEqual([
                    ...live.signals(),
                    ...exited.signals(),
                    ...notStarted.signals(),
                    ...signaled.signals()
                ], [ 'SIGKILL' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'createHardTimeout() starts once while cases are active',
            metadata: {},
            body(scope: OverkillScope) {
                const live = childProcess({ exitCode: null, pid: 1, signalCode: null });
                const { callbacks, clears, runtime } = timeoutRuntime(live.child);

                const timeout = startTimeoutForActiveCase(runtime);
                scope.assert.equal(callbacks().length, 1);
                timeoutCallback(scope, callbacks())();
                timeout.clear();

                scope.assert.equal(clears(), 1);
                scope.assert.equal(runtime.terminalFailure.read(), true);
                scope.assert.deepEqual(live.signals(), [ 'SIGKILL' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'handleCollectionSample() skips terminal runs and records clean samples',
            metadata: {},
            body(scope: OverkillScope) {
                const terminal = collectionRuntime(
                    childProcess({ exitCode: null, pid: 1, signalCode: null }).child,
                    true,
                    null
                );
                const running = collectionRuntime(
                    childProcess({ exitCode: null, pid: 2, signalCode: null }).child,
                    false,
                    null
                );

                handleCollectionSample(resourceSample, terminal);
                handleCollectionSample(resourceSample, running);
                const recordedSample = running.previousSample.read();
                scope.require.notNull(recordedSample);

                scope.assert.equal(terminal.previousSample.read(), null);
                scope.assert.deepEqual(recordedSample, resourceSample);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'handleCollectionSample() reports collection resource budget breaches',
            metadata: {},
            body(scope: OverkillScope) {
                const live = childProcess({ exitCode: null, pid: 1, signalCode: null });
                const runtime = collectionRuntime(live.child, false, -1);

                handleCollectionSample(resourceSample, runtime);

                scope.assert.equal(runtime.terminalFailure.read(), true);
                scope.assert.deepEqual(live.signals(), [ 'SIGKILL' ]);
                scope.assert.equal(runtime.state.runnerErrors()[0]?.subtype, 'resource-exhaustion');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'handleChildMessage() records supervised resource samples',
            metadata: {},
            body(scope: OverkillScope) {
                const runtime = runRuntime(
                    timeoutRuntime(childProcess({ exitCode: null, pid: 1, signalCode: null }).child).runtime
                );

                handleChildMessage({ kind: 'sample', sample: resourceSample }, runtime);
                const recordedSample = runtime.previousSample.read();
                scope.require.notNull(recordedSample);

                scope.assert.deepEqual(recordedSample, resourceSample);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
