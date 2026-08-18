import { createDeterministicWallClock } from '@enormora/wall-clock';
import { doubleUsage, rule, testDouble, type TestDouble } from '@overkill-dev/doubles';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createEngine, type Engine } from './engine.ts';
import type { Execute, ExecuteOptions } from './execution.ts';
import type { RunResult } from './run-result.ts';
import type { TestNode } from './test-node.ts';

type RunIfMainFixture = {
    readonly engine: Engine;
    readonly execute: TestDouble<Execute>;
    readonly readExitCode: () => number | string | null | undefined;
    readonly testNode: TestNode;
};

function importMeta(main: boolean): ImportMeta {
    return {
        dirname: '/test',
        filename: '/test/file.test.ts',
        main,
        resolve(specifier) {
            return specifier;
        },
        url: 'file:///test/file.test.ts'
    };
}

function createRunIfMainFixture(
    result: RunResult,
    initialExitCode: number | string | null | undefined
): RunIfMainFixture {
    let exitCode = initialExitCode;
    const wallClock = createDeterministicWallClock({
        initialCurrentTimestampInMilliseconds: Date.UTC(2026, 6, 15, 12, 30, 0)
    });
    const execute = testDouble<Execute>({
        fallback: rule.calls(async function executeRun(): Promise<RunResult> {
            return result;
        })
    });
    const engine = createEngine({
        execute,
        nodeVersion: '26.1.1',
        readExitCode() {
            return exitCode;
        },
        wallClock,
        writeExitCode(nextExitCode) {
            exitCode = nextExitCode;
        }
    });
    const testNode = engine.createTestCase({
        body(testContext) {
            testContext.assert.true(true, { message: 'passes' });
            return testContext.assert.collect();
        },
        metadata: {},
        name: 'passes'
    });

    return {
        engine,
        execute,
        readExitCode() {
            return exitCode;
        },
        testNode
    };
}

function readExecuteOptions(scope: OverkillScope, execute: TestDouble<Execute>): ExecuteOptions {
    const firstExecute = execute.firstCall;
    scope.require.notNull(firstExecute);
    const executeOptions = firstExecute.arguments[1];

    scope.require.defined(executeOptions);
    scope.require.defined(executeOptions.outputRenderer);
    scope.assert.equal(typeof executeOptions.outputRenderer.render, 'function');

    return executeOptions;
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/run-if-main.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'runIfMain() does nothing when the module is imported',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build(), '7');

                await fixture.engine.runIfMain(importMeta(false), fixture.testNode);

                scope.assert(doubleUsage.callCount, fixture.execute, 0);
                scope.assert.equal(fixture.readExitCode(), '7');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() executes the test node when the module is main',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

                scope.assert(doubleUsage.callCount, fixture.execute, 1);
                const firstExecute = fixture.execute.firstCall;
                scope.require.notNull(firstExecute);
                const firstCase = firstExecute.arguments[0].cases[0];
                scope.require.defined(firstCase);
                scope.assert.equal(firstCase.id.name, 'passes');
                scope.assert.deepEqual(firstExecute.arguments[0].root, {
                    metadata: {},
                    name: 'file:///test/file.test.ts'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() wraps the test node with explicit root data',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode, {
                    root: {
                        metadata: { owner: 'engine' },
                        name: 'engine tests'
                    }
                });

                const firstExecute = fixture.execute.firstCall;
                scope.require.notNull(firstExecute);
                scope.assert.deepEqual(firstExecute.arguments[0].root, {
                    metadata: { owner: 'engine' },
                    name: 'engine tests'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() defaults to no reporters and auto run facts',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

                const executeOptions = readExecuteOptions(scope, fixture.execute);
                scope.assert.deepEqual({
                    execution: executeOptions.execution,
                    reporters: executeOptions.reporters,
                    runFacts: executeOptions.runFacts,
                    startedAt: executeOptions.startedAt
                }, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [],
                    runFacts: { nodeVersion: '26.1.1' },
                    startedAt: '2026-07-15T12:30:00.000Z'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() passes reporters and merges run facts',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);
                const reporter = {
                    dispose: null,
                    kind: 'final-result' as const,
                    name: 'final',
                    onResult() {
                        return undefined;
                    },
                    sinks: []
                };

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode, {
                    reporters: [ reporter ],
                    runFacts: {
                        nodeVersion: '0.0.0',
                        seed: 42
                    }
                });

                const executeOptions = readExecuteOptions(scope, fixture.execute);
                scope.assert.deepEqual({
                    execution: executeOptions.execution,
                    reporters: executeOptions.reporters,
                    runFacts: executeOptions.runFacts,
                    startedAt: executeOptions.startedAt
                }, {
                    execution: { mode: 'serial-in-process' },
                    reporters: [ reporter ],
                    runFacts: {
                        nodeVersion: '26.1.1',
                        seed: 42
                    },
                    startedAt: '2026-07-15T12:30:00.000Z'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() leaves exit code unchanged when the run passes',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build(), undefined);

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

                scope.assert.equal(fixture.readExitCode(), undefined);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() sets exit code when tests fail',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build({ summary: { failed: 1 } }), 0);

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

                scope.assert.equal(fixture.readExitCode(), 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() sets exit code when runner errors are reported',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build({ runnerErrors: [ {} ] }), '0');

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

                scope.assert.equal(fixture.readExitCode(), 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() treats a null exit code as unset',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build({ summary: { failed: 1 } }), null);

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

                scope.assert.equal(fixture.readExitCode(), 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() preserves an existing nonzero exit code',
            metadata: {},
            async body(scope: OverkillScope) {
                const fixture = createRunIfMainFixture(runResultFactory.build({ summary: { failed: 1 } }), 2);

                await fixture.engine.runIfMain(importMeta(true), fixture.testNode);

                scope.assert.equal(fixture.readExitCode(), 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'runIfMain() rejects planning or execution errors',
            metadata: {},
            async body(scope: OverkillScope) {
                let exitCode: number | string | undefined = 0;
                const wallClock = createDeterministicWallClock();
                const execute = testDouble<Execute>({
                    fallback: rule.calls(async function executeRun(): Promise<RunResult> {
                        throw new Error('execution failed');
                    })
                });
                const engine = createEngine({
                    execute,
                    nodeVersion: '26.1.1',
                    readExitCode() {
                        return exitCode;
                    },
                    wallClock,
                    writeExitCode(nextExitCode) {
                        exitCode = nextExitCode;
                    }
                });
                const testNode = engine.createTestCase({
                    body(testContext) {
                        testContext.assert.true(true, { message: 'passes' });
                        return testContext.assert.collect();
                    },
                    metadata: {},
                    name: 'passes'
                });

                await scope.assert.rejects(async function runMain() {
                    await engine.runIfMain(importMeta(true), testNode);
                }, { message: 'execution failed' });
                scope.assert.equal(exitCode, 0);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
