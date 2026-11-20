import { type TestNode, suite, test } from '@overkill-dev/test';
import { createDeterministicClock } from '@enormora/clock';
import type { EngineCaseBody } from '../test-support/create-test-engine.ts';

import { createInMemoryRealTimeReporter, type InMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createEngine, type Engine } from './engine.ts';
import { createExecute } from './execution.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import type { RunResult } from './run-result.ts';

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

async function executeSingleBody(body: EngineCaseBody): Promise<RunResult> {
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

function recordedRunnerErrorMessages(reporter: InMemoryRealTimeReporter): readonly string[] {
    return reporter.getRecordedEntries().flatMap(function toMessage(entry) {
        return entry.event?.kind === 'runner-error'
            ? [ entry.event.error.message ]
            : [];
    });
}

export const testNode: TestNode = suite('async scope control policy', [
    test('scope.drainMicrotasks() waits for already queued promise work', async function (scope) {
        const result = await executeSingleBody(async function testBody(testScope) {
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
    }),
    test(
        'scope.cleanup() runs after signal abort in reverse registration order',
        async function (scope) {
            const events: string[] = [];
            const result = await executeSingleBody(function testBody(testScope) {
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
    ),
    test('scope.cleanup() failures fail the owning test', async function (scope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.cleanup(function failCleanup() {
                throw new Error('cannot clean');
            });
            testScope.assert.true(true);

            return testScope.assert.collect();
        });

        scope.assert.deepEqual(caseVerdicts(result), [ 'fail' ]);
        scope.assert.deepEqual(failureCodes(result), [ 'cleanup-error' ]);

        return scope.assert.collect();
    }),
    test('scope.startInFlight() asserts later rejections', async function (scope) {
        const result = await executeSingleBody(async function testBody(testScope) {
            const task = testScope.startInFlight(async function rejectLater() {
                await Promise.resolve();
                throw new Error('expected rejection');
            });

            await task.rejects({ message: 'expected rejection' });

            return testScope.assert.collect();
        });

        scope.assert.deepEqual(caseVerdicts(result), [ 'pass' ]);

        return scope.assert.collect();
    }),
    test('scope.startInFlight() rejects unobserved settled tasks', async function (scope) {
        const result = await executeSingleBody(async function testBody(testScope) {
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
    }),
    test('execute() reports serial active-resource leaks against the case', async function (scope) {
        let leaking = false;
        const engine = createEngineWithActiveResources(function readActiveResourceTypes() {
            return leaking ? [ 'UnitResource' ] : [];
        });
        const testPlan = engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        body(testScope) {
                            leaking = true;
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
        const reporter = createInMemoryRealTimeReporter();
        const result = await engine.execute(testPlan, {
            debug: { mode: 'off' },
            retryPolicy: null,
            execution: { mode: 'serial-in-process' },
            reporters: [ reporter ],
            runFacts: {},
            startedAt: '2026-07-15T00:00:00.000Z'
        });

        scope.assert.deepEqual(caseVerdicts(result), [ 'runtime-policy' ]);
        scope.assert.equal(result.runnerErrors[0]?.attributedTo?.title, 'leaks');
        scope.assert.deepEqual(recordedRunnerErrorMessages(reporter), [
            result.runnerErrors[0]?.message
        ]);

        return scope.assert.collect();
    }),
    test('execute() reports concurrent active-resource leaks at run scope', async function (scope) {
        let leaking = false;
        const engine = createEngineWithActiveResources(function readActiveResourceTypes() {
            return leaking ? [ 'UnitResource' ] : [];
        });
        const testPlan = engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        body(testScope) {
                            leaking = true;
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
                            leaking = true;
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
        const reporter = createInMemoryRealTimeReporter();
        const result = await engine.execute(testPlan, {
            debug: { mode: 'off' },
            retryPolicy: null,
            execution: { maxConcurrency: 'unlimited', mode: 'concurrent-in-process' },
            reporters: [ reporter ],
            runFacts: {},
            startedAt: '2026-07-15T00:00:00.000Z'
        });

        scope.assert.deepEqual(caseVerdicts(result), [ 'pass', 'pass' ]);
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-policy');
        scope.assert.equal(result.runnerErrors[0]?.attributedTo, null);
        scope.assert.deepEqual(recordedRunnerErrorMessages(reporter), [
            result.runnerErrors[0]?.message
        ]);

        return scope.assert.collect();
    })
]);
