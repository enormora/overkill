import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { executionLifecycle } from '../test-support/execution-lifecycle.ts';
import { currentCaseExecutionLifecycle } from '../engine/case-execution-lifecycle.ts';
import { runExecutionLifecycle } from './execution-session-lifecycle.ts';
import { currentExecutionSession } from './execution-session-context.ts';

export const testNode = suite('execution lifecycle policy', [
    test('loads an isolated lifecycle and validates selection and checkpoints', async function (scope: TestScope) {
        const fixture = executionLifecycle(null);
        const value = await runExecutionLifecycle({
            transport: fixture.transport,
            boundary: null,
            observation: fixture.observation,
            load: fixture.load
        }, async function (lifecycle) {
            scope.assert.equal(currentExecutionSession(), fixture.transport);
            scope.assert.deepEqual<unknown, unknown>(await lifecycle.select(fixture.plan), { kind: 'all' });
            await lifecycle.beforeCases();
            await lifecycle.enterCase(fixture.result.workId);
            scope.assert.equal(await lifecycle.completeCase(fixture.result, []), 'continue');
            scope.assert.deepEqual<unknown, unknown>(lifecycle.snapshot(), {
                events: [ 'create', 'select', 'before', 'enter', 'complete' ]
            });
            return 42;
        });
        scope.assert.equal(value, 42);
        scope.assert.deepEqual<unknown, unknown>(fixture.checkpoints, [ { events: [ 'create', 'select' ] } ]);
        scope.assert.deepEqual<unknown, unknown>(fixture.events, [
            'create',
            'select',
            'before',
            'enter',
            'complete',
            'dispose'
        ]);
        scope.assert.equal(currentExecutionSession(), null);
        return scope.assert.collect();
    }),
    test('bridges case completion and checkpoints failures', async function (scope: TestScope) {
        const fixture = executionLifecycle(null);
        await runExecutionLifecycle({
            transport: fixture.transport,
            boundary: null,
            observation: fixture.observation,
            load: fixture.load
        }, async function () {
            const active = currentCaseExecutionLifecycle();
            scope.require.defined(active);
            scope.assert.equal(await active.complete({ ...fixture.result, verdict: 'fail' }, []), 'continue');
        });
        scope.assert.deepEqual<unknown, unknown>(fixture.checkpoints, [ { events: [ 'create', 'complete' ] } ]);
        return scope.assert.collect();
    }),
    test(
        'stops admission after cancellation but allows disposal and final checkpoints',
        async function (scope: TestScope) {
            const fixture = executionLifecycle(null);
            const failure = new Error('Cancelled lifecycle.');
            await runExecutionLifecycle({
                transport: fixture.transport,
                boundary: null,
                observation: fixture.observation,
                load: fixture.load
            }, async function (lifecycle) {
                fixture.controller.abort(failure);
                await scope.assert.rejects(async function () {
                    return lifecycle.select(fixture.plan);
                }, { exact: failure });
                await scope.assert.rejects(async function () {
                    return lifecycle.beforeCases();
                }, { exact: failure });
                await scope.assert.rejects(async function () {
                    return lifecycle.enterCase(fixture.result.workId);
                }, { exact: failure });
                scope.assert.equal(await lifecycle.completeCase(fixture.result, []), 'stop');
            });
            scope.assert.deepEqual<unknown, unknown>(fixture.events, [ 'create', 'complete', 'dispose' ]);
            return scope.assert.collect();
        }
    ),
    test('disposes after execution failures without losing the original error', async function (scope: TestScope) {
        const fixture = executionLifecycle(null);
        const failure = new Error('Execution failed.');
        await scope.assert.rejects(
            async function () {
                return runExecutionLifecycle({
                    transport: fixture.transport,
                    boundary: null,
                    observation: fixture.observation,
                    load: fixture.load
                }, async function () {
                    throw failure;
                });
            },
            { exact: failure }
        );
        scope.assert.deepEqual<unknown, unknown>(fixture.events, [ 'create', 'dispose' ]);
        return scope.assert.collect();
    }),
    test('surfaces disposal errors after successful execution', async function (scope: TestScope) {
        const failure = new Error('Disposal failed.');
        const fixture = executionLifecycle(failure);
        await scope.assert.rejects(
            async function () {
                return runExecutionLifecycle({
                    transport: fixture.transport,
                    boundary: null,
                    observation: fixture.observation,
                    load: fixture.load
                }, async function () {
                    return 42;
                });
            },
            { exact: failure }
        );
        return scope.assert.collect();
    }),
    test('retains both failures when execution and disposal fail', async function (scope: TestScope) {
        const disposal = new Error('Disposal failed.');
        const failure = new Error('Execution failed.');
        const fixture = executionLifecycle(disposal);
        try {
            await runExecutionLifecycle({
                transport: fixture.transport,
                boundary: null,
                observation: fixture.observation,
                load: fixture.load
            }, async function () {
                throw failure;
            });
            scope.assert.fail();
        } catch (error: unknown) {
            if (!(error instanceof AggregateError)) {
                throw error;
            }
            scope.assert.deepEqual<unknown, unknown>({ errors: error.errors, cause: error.cause }, {
                errors: [ failure, disposal ],
                cause: failure
            });
        }
        return scope.assert.collect();
    }),
    test('rejects missing factories and invalid lifecycle instances', async function (scope: TestScope) {
        const fixture = executionLifecycle(null);
        for (const module of [ null, {}, { create: 42 } ]) {
            await scope.assert.rejects(
                async function () {
                    return runExecutionLifecycle({
                        transport: fixture.transport,
                        boundary: null,
                        observation: fixture.observation,
                        async load() {
                            return module;
                        }
                    }, async function () {
                        return 42;
                    });
                },
                { message: 'Execution lifecycle export must be a factory.' }
            );
        }
        await scope.assert.rejects(
            async function () {
                return runExecutionLifecycle({
                    transport: fixture.transport,
                    boundary: null,
                    observation: fixture.observation,
                    async load() {
                        return {
                            async create() {
                                return {};
                            }
                        };
                    }
                }, async function () {
                    return 42;
                });
            },
            { message: 'Execution lifecycle factory returned an invalid lifecycle.' }
        );
        return scope.assert.collect();
    })
]);
