import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { memoryProcessHelper, helperCommand, failedProcessExecution } from '../test-support/memory-process-helper.ts';
import { reliableProcessHelper } from '../test-support/process-helper-channel.ts';

export const testNode = authoredSuite('process helper invocation ownership', [
    test('forwards commands and correlates completed invocation replies', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        const running = fixture.helper.run(helperCommand, scope.signal);
        await Promise.resolve();
        fixture.events.emit('message', { kind: 'complete', id: 0, execution: failedProcessExecution });
        scope.assert.deepEqual(await running, failedProcessExecution);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.sent[0], {
            kind: 'run',
            id: 0,
            request: helperCommand,
            instrumentation: 'off',
            maximumBytes: 4096,
            timeline: false
        });
        await fixture.helper.close();
        scope.assert.deepEqual(fixture.deadlines, [ 1000 ]);
        return scope.assert.collect();
    }),
    test('cancels the startup timer when the helper becomes ready', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        fixture.clock.advanceByMilliseconds(5000);
        await fixture.helper.close();
        scope.assert.deepEqual(fixture.killed, []);
        return scope.assert.collect();
    }),
    test('rejects work when the helper startup budget expires', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, false, reliableProcessHelper);
        const running = fixture.helper.run(helperCommand, scope.signal);
        fixture.clock.advanceByMilliseconds(5000);
        await scope.assert.rejects(async function () {
            await running;
        }, { message: 'Process helper did not become ready within 5000 milliseconds.' });
        scope.assert.deepEqual(fixture.killed, [ 'SIGKILL' ]);
        return scope.assert.collect();
    }),
    test('cancels active invocations through the helper protocol', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        const running = fixture.helper.run(helperCommand, scope.signal);
        await Promise.resolve();
        fixture.helper.cancel();
        fixture.events.emit('message', { kind: 'complete', id: 0, execution: failedProcessExecution });
        await running;
        await fixture.helper.close();
        scope.assert.deepEqual(
            fixture.sent.map(function (message) {
                return message.kind;
            }),
            [ 'run', 'cancel', 'close' ]
        );
        return scope.assert.collect();
    }),
    test('ignores cancellation when no invocation is active', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        fixture.helper.cancel();
        await fixture.helper.close();
        scope.assert.deepEqual(
            fixture.sent.map(function (message) {
                return message.kind;
            }),
            [ 'close' ]
        );
        return scope.assert.collect();
    }),
    test('rejects cancelled work without sending an invocation', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        await scope.assert.rejects(async function () {
            await fixture.helper.run(helperCommand, AbortSignal.abort(new Error('Cancelled.')));
        }, { message: 'Cancelled.' });
        await fixture.helper.close();
        scope.assert.deepEqual(
            fixture.sent.map(function (message) {
                return message.kind;
            }),
            [ 'close' ]
        );
        return scope.assert.collect();
    }),
    test('rejects overlapping invocations without replacing the active command', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        const running = fixture.helper.run(helperCommand, scope.signal);
        await Promise.resolve();
        await scope.assert.rejects(async function () {
            await fixture.helper.run(helperCommand, scope.signal);
        }, { message: 'Process helper already owns an invocation.' });
        fixture.events.emit('message', { kind: 'complete', id: 0, execution: failedProcessExecution });
        await running;
        await fixture.helper.close();
        scope.assert.equal(
            fixture
                .sent
                .filter(function (message) {
                    return message.kind === 'run';
                })
                .length,
            1
        );
        return scope.assert.collect();
    }),
    test('kills a helper that replies to an unknown invocation', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        const running = fixture.helper.run(helperCommand, scope.signal);
        await Promise.resolve();
        fixture.events.emit('message', { kind: 'complete', id: 99, execution: failedProcessExecution });
        await scope.assert.rejects(async function () {
            await running;
        }, { message: 'Invalid process helper reply.' });
        scope.assert.deepEqual(fixture.killed, [ 'SIGKILL' ]);
        return scope.assert.collect();
    }),
    test('retains diagnostics and terminates the owned target group on disconnect', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, reliableProcessHelper);
        const running = fixture.helper.run(helperCommand, scope.signal);
        await Promise.resolve();
        fixture.events.emit('message', { kind: 'started', id: 0, pid: 4321 });
        fixture.stderr.emit('data', Buffer.from('Target diagnostic.'));
        fixture.close(1, null);
        await scope.assert.rejects(async function () {
            await running;
        }, { message: 'Process helper closed: 1, null. Target diagnostic.' });
        scope.assert.deepEqual(fixture.groups, [ { pid: 4321, signal: 'SIGKILL' } ]);
        return scope.assert.collect();
    }),
    test('retains send failures as invocation errors', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, { ...reliableProcessHelper, send: new Error('Send failed.') });
        await scope.assert.rejects(async function () {
            await fixture.helper.run(helperCommand, scope.signal);
        }, { message: 'Send failed.' });
        return scope.assert.collect();
    }),
    test('forces helper termination when shutdown exceeds its budget', async function (scope: TestScope) {
        const fixture = memoryProcessHelper(scope, true, {
            ...reliableProcessHelper,
            shutdown: new Error('Shutdown expired.')
        });
        await scope.assert.rejects(async function () {
            await fixture.helper.close();
        }, { message: 'Shutdown expired.' });
        scope.assert.deepEqual(fixture.killed, [ 'SIGKILL' ]);
        return scope.assert.collect();
    })
]);
