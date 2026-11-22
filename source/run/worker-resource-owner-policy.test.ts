import { table, suite, test } from '@overkill-dev/test';

import { workerResourceOwner } from '../test-support/worker-resource-owner.ts';
import {
    completeWorkerPoolResourceMembers,
    disposeWorkerPoolResourceLifecycles,
    workerPoolProjectedResourcesForWork
} from './worker-pool-resource-lifecycle-execution.ts';

export const testNode = suite('worker resource owner acknowledgements', [
    table({
        title: 'settles owner completion response exactly once',
        cases: [ { runnerErrors: [] }, null, new Error('owner disconnected') ].map(function (output, index) {
            return { output, index };
        }),
        caseTitle({ output }) {
            if (output instanceof Error) {
                return 'disconnected owner';
            }
            return output === null ? 'missing response' : 'successful response';
        },
        async test(scope) {
            const { output, index } = scope.parameters;

            const fixture = await workerResourceOwner(output);
            scope.cleanup(fixture.runtime.pool.destroy);
            await completeWorkerPoolResourceMembers(fixture.runtime, fixture.lifecycle, fixture.members);
            await completeWorkerPoolResourceMembers(fixture.runtime, fixture.lifecycle, fixture.members);
            scope.assert.deepEqual(fixture.calls, [ 'acquire-run-resources', 'complete-resource-owner-work' ]);
            scope.assert.equal(fixture.runtime.terminalFailure.read(), index !== 0);
            scope.assert.deepEqual(
                fixture.runtime.runState.runnerErrors().map(function (error) {
                    return error.message;
                }),
                index === 0 ? [] : [ 'Worker-pool resource owner completion failed.' ]
            );
            return scope.assert.collect();
        }
    }),
    test('disposes an infrastructure owner after successful completion', async function (scope) {
        const fixture = await workerResourceOwner({ runnerErrors: [] });
        scope.cleanup(fixture.runtime.pool.destroy);
        await completeWorkerPoolResourceMembers(fixture.runtime, fixture.lifecycle, fixture.members);
        await disposeWorkerPoolResourceLifecycles(fixture.runtime, fixture.plan, fixture.lifecycle);
        scope.assert.deepEqual(fixture.calls, [
            'acquire-run-resources',
            'complete-resource-owner-work',
            'dispose-run-resources'
        ]);
        scope.assert.deepEqual(fixture.runtime.runState.runnerErrors(), []);
        return scope.assert.collect();
    }),
    test('projects only the boundaries required by assigned work', async function (scope) {
        const fixture = await workerResourceOwner({ runnerErrors: [] });
        scope.cleanup(fixture.runtime.pool.destroy);
        const work = fixture.members.flatMap(function (member) {
            return member.unit.work;
        });
        scope.assert.deepEqual(workerPoolProjectedResourcesForWork(fixture.lifecycle, work), {
            resources: [ { boundaryKey: 'owner', payload: 'handle' } ]
        });
        scope.assert.deepEqual(workerPoolProjectedResourcesForWork(fixture.lifecycle, []), { resources: [] });
        return scope.assert.collect();
    })
]);
