import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { executionSessionRuntime } from '../test-support/execution-session-runtime.ts';
import { testNode as collected } from './collected-session-policy.test.ts';
import { testNode as fresh } from './fresh-execution-host-policy.test.ts';
import { testNode as host } from './execution-host-policy.test.ts';
import { createManagedExecutionSession } from './execution-session.ts';
import { runExecutionFailure } from './execution-failure.ts';
import type { RunExecutionReply } from './execution-session-types.ts';
import type { ExecutionSessionCall } from './execution-session-runtime-types.ts';

const invocation = { data: { value: 42 }, timeoutMilliseconds: 50, signal: null };
export const testNode = suite('execution session ownership', [
    collected,
    host,
    fresh,
    test('initializes once and reuses its environment for sequential invocations', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(fixture.options, fixture.runtime);
        scope.assert.equal(fixture.initialized.length, 0);
        const first = await session.run(invocation);
        scope.assert.deepEqual<unknown, unknown>(first.data, invocation.data);
        await session.run({ ...invocation, timeoutMilliseconds: 40 });
        scope.assert.deepEqual(
            fixture.calls.map(function (call) {
                return call.timeoutMilliseconds;
            }),
            [ 50, 40 ]
        );
        scope.assert.deepEqual({ lifetime: session.environmentLifetime, initialized: fixture.initialized.length }, {
            lifetime: 'reused',
            initialized: 1
        });
        await session.dispose();
        return scope.assert.collect();
    }),
    test('honors explicit fresh-invocation lifetime', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(
            { ...fixture.options, environment: 'fresh-invocation' },
            fixture.runtime
        );
        scope.assert.equal(session.environmentLifetime, 'fresh');
        await session.dispose();
        return scope.assert.collect();
    }),
    test('returns timeout replies for invalid deadlines without initialization', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(fixture.options, fixture.runtime);
        for (const timeoutMilliseconds of [ 0, -1, Number.NaN, Number.POSITIVE_INFINITY ]) {
            scope.assert.deepEqual(await session.run({ ...invocation, timeoutMilliseconds }), {
                kind: 'timeout',
                artifacts: [],
                data: null
            });
        }
        scope.assert.deepEqual(fixture.initialized, []);
        await session.dispose();
        return scope.assert.collect();
    }),
    test('rejects invocation admission after disposal', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(fixture.options, fixture.runtime);
        await session.dispose();
        await scope.assert.rejects(async function () {
            return await session.run(invocation);
        }, { message: 'Execution session has been disposed.' });
        scope.assert.deepEqual(fixture.initialized, []);
        return scope.assert.collect();
    }),
    test('rejects overlapping invocations and admits work after completion', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const completion = Promise.withResolvers<RunExecutionReply>();
        const session = createManagedExecutionSession(fixture.options, {
            ...fixture.runtime,
            async initialize() {
                return {
                    ...fixture.environment,
                    async execute() {
                        return await completion.promise;
                    }
                };
            }
        });
        const running = session.run(invocation);
        await scope.assert.rejects(async function () {
            return await session.run(invocation);
        }, { message: 'An execution invocation is already running.' });
        completion.resolve(fixture.reply);
        const results = { active: await running, next: await session.run(invocation) };
        scope.assert.deepEqual({ active: results.active.kind, next: results.next.kind }, {
            active: 'result',
            next: 'result'
        });
        await session.dispose();
        return scope.assert.collect();
    }),
    test('retains a copy of the latest checkpoint after an execution failure', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const checkpoint = { value: 1 };
        const session = createManagedExecutionSession(fixture.options, {
            ...fixture.runtime,
            async initialize() {
                return {
                    ...fixture.environment,
                    async execute(call: ExecutionSessionCall) {
                        await call.checkpoint(checkpoint);
                        Object.assign(checkpoint, { value: 2 });
                        throw new Error('Execution failed.');
                    }
                };
            }
        });
        const result = await session.run(invocation);
        scope.assert.equal(result.kind, 'failure');
        scope.assert.deepEqual<unknown, unknown>(result.data, { value: 1 });
        if (result.kind === 'failure') {
            scope.assert.equal(result.failure.message, 'Execution failed.');
        }
        await session.dispose();
        return scope.assert.collect();
    }),
    test('retains completed results while marking an expired deadline', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(fixture.options, {
            ...fixture.runtime,
            async initialize() {
                return {
                    ...fixture.environment,
                    async execute() {
                        fixture.clock.advanceByMilliseconds(50);
                        return fixture.reply;
                    }
                };
            }
        });
        const result = await session.run(invocation);
        scope.assert.equal(result.kind, 'result');
        if (result.kind === 'result') {
            scope.assert.true(result.deadlineExceeded);
        }
        await session.dispose();
        return scope.assert.collect();
    }),
    test('converts thrown deadline cancellation to a timeout reply', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(fixture.options, {
            ...fixture.runtime,
            async initialize() {
                return {
                    ...fixture.environment,
                    async execute(call: ExecutionSessionCall) {
                        fixture.clock.advanceByMilliseconds(50);
                        call.signal.throwIfAborted();
                        return fixture.reply;
                    }
                };
            }
        });
        scope.assert.deepEqual(await session.run(invocation), { kind: 'timeout', artifacts: [], data: null });
        await session.dispose();
        return scope.assert.collect();
    }),
    test('converts deadline cancellation reported by a backend to timeout', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(fixture.options, {
            ...fixture.runtime,
            async initialize() {
                return {
                    ...fixture.environment,
                    async execute(call: ExecutionSessionCall) {
                        fixture.clock.advanceByMilliseconds(50);
                        return {
                            kind: 'failure',
                            failure: runExecutionFailure(new Error('Interrupted.', { cause: call.signal.reason })),
                            artifacts: [],
                            data: { checkpoint: 1 }
                        };
                    }
                };
            }
        });
        scope.assert.deepEqual(await session.run(invocation), {
            kind: 'timeout',
            artifacts: [],
            data: { checkpoint: 1 }
        });
        await session.dispose();
        return scope.assert.collect();
    }),
    test('returns initialization failures without running an environment', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const session = createManagedExecutionSession(fixture.options, {
            ...fixture.runtime,
            async initialize() {
                throw new Error('Initialization failed.');
            }
        });
        const result = await session.run(invocation);
        scope.assert.equal(result.kind, 'failure');
        if (result.kind === 'failure') {
            scope.assert.equal(result.failure.message, 'Initialization failed.');
        }
        scope.assert.deepEqual(fixture.calls, []);
        await session.dispose();
        return scope.assert.collect();
    }),
    test('does not initialize for an already cancelled invocation', async function (scope: TestScope) {
        const fixture = await executionSessionRuntime();
        const failure = new Error('Cancelled.');
        const session = createManagedExecutionSession(fixture.options, fixture.runtime);
        const result = await session.run({ ...invocation, signal: AbortSignal.abort(failure) });
        scope.assert.equal(result.kind, 'failure');
        scope.assert.deepEqual({ calls: fixture.calls, initialized: fixture.initialized }, {
            calls: [],
            initialized: []
        });
        if (result.kind === 'failure') {
            scope.assert.equal(result.failure.message, failure.message);
        }
        await session.dispose();
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
