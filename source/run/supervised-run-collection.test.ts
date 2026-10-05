import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createFakeSupervisedChildProcess } from '../test-support/fake-supervised-child-process.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import { collectSupervisedRun } from './supervised-run-collection.ts';
import {
    supervisedChildEnvelope,
    type SupervisedCollectCommand
} from './supervised-protocol.ts';

type TimeoutCallback = () => void;
type SupervisedChildExitListener = () => void;
type SupervisedChildMessageListener = (message: unknown) => void;

function supervisedCollectCommand(): SupervisedCollectCommand {
    return {
        retryPolicy: null,
        capabilityRestrictions: { mode: 'disabled' },
        capture: 'buffered',
        collectionTimeoutMilliseconds: 100,
        cwd: process.cwd(),
        definitionLocationCapture: 'disabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 1000,
        maxConcurrency: 5,
        kind: 'collect',
        paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ],
        resourceBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        resourceUsageSamplingIntervalMilliseconds: 1,
        root: { annotations: {}, controls: {}, title: process.cwd() },
        scheduling: 'serial',
        testFamily: 'microtest',
        timeoutMilliseconds: 1000
    };
}

function collectedPlan(): CollectedRunPlan {
    return {
        defined: 0,
        discoveredFiles: [],
        files: [],
        orphans: [],
        root: {
            annotations: { ownership: [], tags: [] },
            controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
            title: 'supervised collection'
        }
    };
}

function createTimeoutChild(readTimeoutCallback: () => TimeoutCallback): SupervisedChildProcess {
    const exitListeners: SupervisedChildExitListener[] = [];

    return {
        exitCode: null,
        kill() {
            for (const listener of exitListeners) {
                listener();
            }
        },
        on(...registration) {
            const [ event, listener ] = registration;

            if (event === 'exit') {
                exitListeners.push(listener);
            }
        },
        pid: 1,
        send() {
            readTimeoutCallback()();
        },
        signalCode: null,
        stderr: null,
        stdout: null
    };
}

async function createEventChild(): Promise<SupervisedChildProcess> {
    const exitListeners: SupervisedChildExitListener[] = [];
    const messageListeners: SupervisedChildMessageListener[] = [];

    return {
        exitCode: null,
        kill() {
            for (const listener of exitListeners) {
                listener();
            }
        },
        on(...registration) {
            const [ event, listener ] = registration;

            if (event === 'message') {
                messageListeners.push(listener);
            } else if (event === 'exit') {
                exitListeners.push(listener);
            }
        },
        pid: 1,
        send() {
            for (const listener of messageListeners) {
                listener(supervisedChildEnvelope({
                    event: {
                        error: {
                            attributedToAttempt: null,
                            attributedTo: null,
                            attributedToWork: null,
                            cause: null,
                            diagnostics: [],
                            message: 'Collected with runner error.',
                            subtype: 'loader'
                        },
                        kind: 'runner-error'
                    },
                    kind: 'event'
                }));
                listener(supervisedChildEnvelope({
                    kind: 'sample',
                    sample: {
                        activeResourceCount: 0,
                        activeResourceTypes: [],
                        capturedAtMicroseconds: 0,
                        javaScriptEngineHeapBytes: 0,
                        residentSetBytes: 0
                    }
                }));
                listener(supervisedChildEnvelope({
                    collectedPlan: collectedPlan(),
                    kind: 'collected',
                    runnerErrors: []
                }));
            }

            for (const listener of exitListeners) {
                listener();
            }
        },
        signalCode: null,
        stderr: null,
        stdout: null
    };
}

function timeoutDependencies(): RunOrchestratorDependencies {
    const baseDependencies = fakeWorkerPoolRuntimeDependencies();
    let timeoutCallback: TimeoutCallback = function missingTimeoutCallback() {
        throw new Error('Expected timeout callback.');
    };

    return {
        ...baseDependencies,
        async startSupervisedChild() {
            return createTimeoutChild(function readTimeoutCallback() {
                return timeoutCallback;
            });
        },
        wallClock: {
            ...baseDependencies.wallClock,
            clearTimeout() {
                return undefined;
            },
            setTimeout<HandlerArguments extends readonly unknown[]>(
                callback: (...handlerArguments: HandlerArguments) => void,
                delayInMilliseconds: number,
                ...handlerArguments: HandlerArguments
            ) {
                timeoutCallback = function invokeTimeoutCallback() {
                    callback(...handlerArguments);
                };

                return baseDependencies.wallClock.setTimeout(
                    callback,
                    delayInMilliseconds,
                    ...handlerArguments
                );
            }
        }
    };
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-collection.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'collectSupervisedRun() records collection spawn and ready timings',
            async body(scope: OverkillScope) {
                const dependencies = fakeWorkerPoolRuntimeDependencies();
                const timing = createRunTimingMeasurement(dependencies.wallClock);
                const result = await collectSupervisedRun(
                    supervisedCollectCommand(),
                    {
                        ...dependencies,
                        async startSupervisedChild() {
                            return createFakeSupervisedChildProcess({
                                collect() {
                                    return {
                                        collectedPlan: collectedPlan(),
                                        runnerErrors: []
                                    };
                                },
                                run() {
                                    return undefined;
                                }
                            });
                        }
                    },
                    timing
                );

                scope.assert.equal(result.collectedPlan.files.length, 0);
                scope.assert.deepEqual(
                    timing.report().spans.map(function toKind(span) {
                        return span.kind;
                    }),
                    [ 'supervised-process.spawn', 'supervised-process.ready' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'collectSupervisedRun() preserves runner errors emitted before collection',
            async body(scope: OverkillScope) {
                const result = await collectSupervisedRun(supervisedCollectCommand(), {
                    ...fakeWorkerPoolRuntimeDependencies(),
                    startSupervisedChild: createEventChild
                });

                scope.assert.equal(result.runnerErrors[0]?.message, 'Collected with runner error.');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'collectSupervisedRun() reports collection timeouts as runner errors',
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function collectTimedOutRun() {
                    await collectSupervisedRun(supervisedCollectCommand(), timeoutDependencies());
                }, {
                    message: 'Supervised collection exceeded collection timeout.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
