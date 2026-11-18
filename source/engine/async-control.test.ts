import { setImmediate as scheduleImmediate } from 'node:timers';
import { runIfMain } from '#test-runner';
import { createDeterministicClock } from '@enormora/clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';

import { createEngine, type Engine } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import type { RunResult } from './run-result.ts';
import type { TestBody, TestScope } from './test-scope.ts';

function ignoreOutputLine(): void {
    return undefined;
}

function createEngineWithActiveResources(readActiveResourceTypes: () => readonly string[]): Engine {
    const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });

    return createEngine({
        execute: createExecute({
            benchmarkEnvironment: null,
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
            title: 'execute() waits one turn before active-resource leak diagnostics',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let allocated = false;
                let resourceReleased = false;
                const engine = createEngineWithActiveResources(function readActiveResourceTypes() {
                    if (!allocated || resourceReleased) {
                        return [];
                    }

                    return [ 'UnitResource' ];
                });
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    allocated = true;
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
                    debug: { mode: 'off' },
                    retryPolicy: null,
                    execution: { mode: 'serial-in-process' },
                    reporters: [],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);
                scope.assert.deepEqual(result.runnerErrors, []);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
