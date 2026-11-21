import { table, suite, test } from '@overkill-dev/test';

import { freshExecutionHost } from '../test-support/fresh-execution-host.ts';
import { executeFreshSession } from './execution-session-process.ts';

export const testNode = suite('fresh execution host transport and cleanup', [
    test(
        'sends the frozen invocation and closes the child after receiving its result',
        async function (scope) {
            const fixture = await freshExecutionHost('none');
            const result = await executeFreshSession(fixture.request, fixture.start);
            scope.assert.equal(result.kind, 'result');
            scope.assert.partialDeepEqual<unknown, unknown>(fixture.sent, [ {
                seed: { value: 42n },
                selection: { kind: 'all' },
                transport: fixture.request.transport,
                timeoutMilliseconds: 10
            } ]);
            scope.assert.deepEqual(fixture.events, [ 'start', 'send', 'SIGKILL' ]);
            return scope.assert.collect();
        }
    ),
    test(
        'delivers checkpoints and waits for their completion before returning',
        async function (scope) {
            const fixture = await freshExecutionHost('checkpoint');
            const result = await executeFreshSession(fixture.request, fixture.start);
            scope.assert.equal(result.kind, 'result');
            scope.assert.deepEqual(fixture.events, [ 'start', 'send', 'checkpoint', 'SIGKILL' ]);
            return scope.assert.collect();
        }
    ),
    test('rejects failed checkpoint delivery and still closes the child', async function (scope) {
        const fixture = await freshExecutionHost('checkpoint-failure');
        await scope.assert.rejects(async function () {
            return await executeFreshSession(fixture.request, fixture.start);
        }, { exact: fixture.failure });
        scope.assert.deepEqual(fixture.events, [ 'start', 'send', 'checkpoint', 'SIGKILL' ]);
        return scope.assert.collect();
    }),
    test('reports premature host exits with their exit status', async function (scope) {
        const fixture = await freshExecutionHost('exit');
        await scope.assert.rejects(async function () {
            return await executeFreshSession(fixture.request, fixture.start);
        }, { message: 'Execution host exited without a result (1, null).' });
        scope.assert.equal(fixture.events.at(-1), 'SIGKILL');
        return scope.assert.collect();
    }),
    table({
        title: 'preserves failures while closing the child',
        cases: [ 'error', 'send' ] as const,
        caseTitle(fault) {
            return fault;
        },
        async test(scope) {
            const fault = scope.parameters;

            const fixture = await freshExecutionHost(fault);
            await scope.assert.rejects(async function () {
                return await executeFreshSession(fixture.request, fixture.start);
            }, { exact: fixture.failure });
            scope.assert.deepEqual(fixture.events, [ 'start', 'send', 'SIGKILL' ]);
            return scope.assert.collect();
        }
    }),
    test('rejects malformed replies and closes their host', async function (scope) {
        const fixture = await freshExecutionHost('invalid');
        await scope.assert.rejects(async function () {
            return await executeFreshSession(fixture.request, fixture.start);
        }, { name: 'ZodError' });
        scope.assert.equal(fixture.events.at(-1), 'SIGKILL');
        return scope.assert.collect();
    }),
    test('rejects cancellation before allocating a host', async function (scope) {
        const fixture = await freshExecutionHost('none');
        const failure = new Error('cancelled');
        const controller = new AbortController();
        controller.abort(failure);
        await scope.assert.rejects(async function () {
            return await executeFreshSession({
                ...fixture.request,
                observation: { ...fixture.request.observation, signal: controller.signal }
            }, fixture.start);
        }, { exact: failure });
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    })
]);
