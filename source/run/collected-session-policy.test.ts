import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { collectedSession, collectedSessionFault } from '../test-support/collected-session.ts';
import { InvocationDeadlineExceededError } from '../invocation-budget.ts';
import { testNode as admission } from './execution-session-admission-policy.test.ts';
import { testNode as replies } from './execution-reply-policy.test.ts';

export const testNode = authoredSuite('reused collected session policy', [
    admission,
    replies,
    authoredTest(
        'collects once while selecting and disposing a lifecycle for each invocation',
        async function (scope: TestScope) {
            const fixture = await collectedSession(collectedSessionFault);
            scope.assert.equal(fixture.collections(), 0);
            const first = await fixture.session.execute(fixture.call);
            const second = await fixture.session.execute(fixture.call);
            scope.assert.deepEqual({ lifetime: fixture.session.lifetime, collections: fixture.collections() }, {
                lifetime: 'reused',
                collections: 1
            });
            scope.assert.deepEqual(fixture.runs, [ { selection: { kind: 'all' } }, { selection: { kind: 'all' } } ]);
            scope.assert.partialDeepEqual(first, {
                kind: 'result',
                deadlineExceeded: false,
                result: { status: 'passed' }
            });
            scope.assert.partialDeepEqual(second, { kind: 'result', deadlineExceeded: false });
            scope.assert.deepEqual(fixture.lifecycle.events, [
                'create',
                'select',
                'before',
                'dispose',
                'create',
                'select',
                'before',
                'dispose'
            ]);
            return scope.assert.collect();
        }
    ),
    ...([ 'collect', 'execute', 'checkpoint', 'dispose' ] as const).map(function (phase) {
        return authoredTest(`returns ${phase} failures through the reply protocol`, async function (scope: TestScope) {
            const error = new Error(`${phase} failed`);
            const fixture = await collectedSession({ ...collectedSessionFault, [phase]: error });
            const reply = await fixture.session.execute(fixture.call);
            scope.assert.partialDeepEqual(reply, { kind: 'failure', failure: { message: `${phase} failed` } });
            scope.assert.equal(reply.kind, 'failure');
            scope.assert.equal(fixture.collections(), 1);
            return scope.assert.collect();
        });
    }),
    authoredTest('retains a rejected collection rather than silently recollecting', async function (scope: TestScope) {
        const fixture = await collectedSession({ ...collectedSessionFault, collect: new Error('collection failed') });
        const first = await fixture.session.execute(fixture.call);
        const second = await fixture.session.execute(fixture.call);
        scope.assert.equal(first.kind, 'failure');
        scope.assert.equal(second.kind, 'failure');
        scope.assert.equal(fixture.collections(), 1);
        scope.assert.deepEqual(fixture.runs, []);
        return scope.assert.collect();
    }),
    authoredTest(
        'returns timeout only for cancellation caused by its invocation deadline',
        async function (scope: TestScope) {
            const error = new InvocationDeadlineExceededError();
            const fixture = await collectedSession({ ...collectedSessionFault, execute: error });
            fixture.lifecycle.controller.abort(error);
            const reply = await fixture.session.execute(fixture.call);
            scope.assert.partialDeepEqual(reply, { kind: 'timeout', artifacts: [] });
            scope.assert.equal(fixture.collections(), 1);
            return scope.assert.collect();
        }
    ),
    authoredTest('preserves ordinary cancellation as a failure', async function (scope: TestScope) {
        const error = new Error('cancelled');
        const fixture = await collectedSession(collectedSessionFault);
        fixture.lifecycle.controller.abort(error);
        const reply = await fixture.session.execute(fixture.call);
        scope.assert.partialDeepEqual(reply, { kind: 'failure', failure: { message: 'cancelled' } });
        return scope.assert.collect();
    })
]);
