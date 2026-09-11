import { setImmediate as scheduleImmediate } from 'node:timers';
import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createEngine, type Engine } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import type { RunResult } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

function ignoreOutputLine(): void {
    return undefined;
}

function createEngineWithActiveResources(readActiveResourceTypes: () => readonly string[]): Engine {
    const wallClock = createDeterministicWallClock();

    return createEngine({
        execute: createExecute({
            asyncLeakDiagnostics: 'enabled',
            readActiveResourceTypes,
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: ignoreOutputLine },
                stdout: { writeLine: ignoreOutputLine },
                wallClock
            }),
            wallClock
        }),
        wallClock
    });
}

function createAsyncControlEngine(): Engine {
    return createEngineWithActiveResources(function readNoActiveResources() {
        return [];
    });
}

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createAsyncControlEngine();
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    body,
                    definitionLocations: [ { kind: 'unknown' } ],
                    annotations: {},
                    controls: {},
                    title: 'test'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        })
    );

    return await engine.execute(testPlan);
}

function failureCodes(result: RunResult): readonly string[] {
    const outcome = result.perTest[0]?.outcome;

    return outcome?.kind === 'fail'
        ? outcome.failures.flatMap(function toFailureCode(failure) {
            return failure.kind === 'test-contract' ? [ failure.code ] : [ failure.kind ];
        })
        : [];
}

function caseVerdicts(result: RunResult): readonly string[] {
    return result.perTest.map(function toVerdict(testResult) {
        return testResult.verdict;
    });
}

type EventLog = {
    readonly add: (event: string) => void;
};

function finishCascade(events: EventLog): void {
    events.add('done');
}

function scheduleCascadeMicrotask(events: EventLog): void {
    queueMicrotask(function runCascadeMicrotask() {
        finishCascade(events);
    });
}

function scheduleCascadeNextTurn(events: EventLog): void {
    scheduleImmediate(function runCascadeNextTurn() {
        scheduleCascadeMicrotask(events);
    });
}

function scheduleFiniteCascade(events: EventLog): void {
    queueMicrotask(function startCascade() {
        scheduleCascadeNextTurn(events);
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/async-control.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.drainMicrotasks() waits for already queued promise work',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    let finished = false;

                    queueMicrotask(function finishMicrotask() {
                        finished = true;
                    });

                    testScope.assert.equal(finished, false);
                    await testScope.drainMicrotasks();
                    testScope.assert.equal(finished, true);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.yieldToNextTurn() waits for setImmediate work',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    let finished = false;

                    scheduleImmediate(function finishNextTurn() {
                        finished = true;
                    });

                    testScope.assert.equal(finished, false);
                    await testScope.yieldToNextTurn();
                    testScope.assert.equal(finished, true);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.settleAsyncWork() checkpoints finite queue cascades',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    const events: string[] = [];
                    const eventLog: EventLog = {
                        add(event) {
                            events.push(event);
                        }
                    };

                    scheduleFiniteCascade(eventLog);

                    await testScope.settleAsyncWork();

                    testScope.assert.deepEqual(events, [ 'done' ]);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.cleanup() runs after signal abort in reverse registration order',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const events: string[] = [];
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.cleanup(function firstCleanup() {
                        events.push(`first:${String(testScope.signal.aborted)}`);
                    });
                    testScope.cleanup(function secondCleanup() {
                        events.push(`second:${String(testScope.signal.aborted)}`);
                    });

                    testScope.assert.equal(testScope.signal.aborted, false);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);
                scope.assert.deepEqual(events, [ 'second:true', 'first:true' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.cleanup() failures fail the owning test',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.cleanup(function failCleanup() {
                        throw new Error('cannot clean');
                    });
                    testScope.assert.true(true);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'fail' ]);
                scope.assert.deepEqual(failureCodes(result), [ 'cleanup-error' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.startInFlight() asserts later rejections',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    const task = testScope.startInFlight(async function rejectLater() {
                        await Promise.resolve();
                        throw new Error('expected rejection');
                    });

                    await task.rejects({ message: 'expected rejection' });

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.startInFlight() rejects unobserved settled tasks',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    testScope.startInFlight(async function startTask() {
                        return 'done';
                    });
                    await testScope.drainMicrotasks();
                    testScope.assert.true(true);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'fail' ]);
                scope.assert.deepEqual(failureCodes(result), [ 'unobserved-in-flight-task' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'scope.startInFlight() rejects pending tasks',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    const pendingResolutions: ((value: never) => void)[] = [];
                    testScope.startInFlight(async function startTask() {
                        return await new Promise<never>(function neverSettle(resolve) {
                            pendingResolutions.push(resolve);
                        });
                    });
                    testScope.assert.true(true);
                    testScope.assert.equal(pendingResolutions.length, 1);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'fail' ]);
                scope.assert.deepEqual(failureCodes(result), [ 'pending-in-flight-task' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() reports generic pending promises as runtime policy leaks',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const leakedPromises: Promise<unknown>[] = [];
                const leakedPromiseResolutions: ((value: never) => void)[] = [];
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    leakedPromises.push(
                        new Promise(function neverSettle(resolve: (value: never) => void) {
                            leakedPromiseResolutions.push(resolve);
                        })
                    );
                    testScope.assert.true(true);
                    testScope.assert.equal(leakedPromiseResolutions.length, 1);

                    return testScope.assert.collect();
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'runtime-policy' ]);
                scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-policy');
                scope.assert.equal(result.runnerErrors[0]?.attributedTo?.title, 'test');
                scope.assert.equal(leakedPromises.length, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() reports serial active-resource leaks against the case',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let readCount = 0;
                const engine = createEngineWithActiveResources(function readActiveResourceTypes() {
                    readCount += 1;
                    return readCount === 1 ? [] : [ 'Timeout' ];
                });
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                definitionLocations: [ { kind: 'unknown' } ],
                                annotations: {},
                                controls: {},
                                title: 'leaks'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'runtime-policy' ]);
                scope.assert.equal(result.runnerErrors[0]?.attributedTo?.title, 'leaks');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() waits one turn before active-resource leak diagnostics',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let readCount = 0;
                let resourceReleased = false;
                const engine = createEngineWithActiveResources(function readActiveResourceTypes() {
                    readCount += 1;

                    if (readCount === 1 || resourceReleased) {
                        return [];
                    }

                    return [ 'ProcessWrap' ];
                });
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    scheduleImmediate(function releaseResource() {
                                        resourceReleased = true;
                                    });
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                definitionLocations: [ { kind: 'unknown' } ],
                                annotations: {},
                                controls: {},
                                title: 'releases'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);
                scope.assert.deepEqual(result.runnerErrors, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() reports concurrent active-resource leaks at run scope',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let readCount = 0;
                const engine = createEngineWithActiveResources(function readActiveResourceTypes() {
                    readCount += 1;
                    return readCount === 1 ? [] : [ 'Timeout' ];
                });
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                definitionLocations: [ { kind: 'unknown' } ],
                                annotations: {},
                                controls: {},
                                title: 'first'
                            }),
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                definitionLocations: [ { kind: 'unknown' } ],
                                annotations: {},
                                controls: {},
                                title: 'second'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'concurrent-in-process' },
                    reporters: [],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass', 'pass' ]);
                scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-policy');
                scope.assert.equal(result.runnerErrors[0]?.attributedTo, null);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
