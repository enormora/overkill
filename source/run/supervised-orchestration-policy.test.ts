import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { supervisedRunOrchestration } from '../test-support/supervised-run-orchestration.ts';
import { testNode as finalization } from './supervised-finalization-policy.test.ts';
import { testNode as messages } from './supervised-message-policy.test.ts';

export const testNode = authoredSuite('memory supervised run orchestration', [
    authoredTest('retains process samples arriving before collection completes', async function (scope: TestScope) {
        const fixture = supervisedRunOrchestration('collection-sample', false, 'buffered');
        const result = await fixture.execute();
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.deepEqual(fixture.events, [ 'start', 'collect', 'run' ]);
        return scope.assert.collect();
    }),
    ...([ 'empty-result', 'duplicate-result', 'forbidden-event' ] as const).map(function (scenario) {
        return authoredTest(`rejects malformed child protocol ${scenario}`, async function (scope: TestScope) {
            const fixture = supervisedRunOrchestration(scenario, false, 'buffered');
            const result = await fixture.execute();
            scope.assert.equal(result.status, 'failed');
            scope.assert.deepEqual(
                result.runnerErrors.map(function (error) {
                    return { message: error.message, subtype: error.subtype };
                }),
                [ { message: 'Invalid supervised child IPC lifecycle.', subtype: 'crash' } ]
            );
            return scope.assert.collect();
        });
    }),
    messages,
    finalization,
    ...([ false, true ] as const).flatMap(function (timed) {
        return ([ 'buffered', 'live' ] as const).map(function (capture) {
            return authoredTest(
                `executes a supervised child with timing ${timed} and ${capture} output`,
                async function (scope: TestScope) {
                    const fixture = supervisedRunOrchestration('pass', timed, capture);
                    const result = await fixture.execute();
                    scope.assert.equal(result.status, 'passed');
                    scope.assert.equal(result.summary.passed, 1);
                    scope.assert.deepEqual(result.runnerErrors, []);
                    scope.assert.deepEqual(
                        fixture.events,
                        capture === 'live'
                            ? [ 'start', 'collect', 'run', 'stdout:child output', 'stderr:child diagnostics' ]
                            : [ 'start', 'collect', 'run' ]
                    );
                    return scope.assert.collect();
                }
            );
        });
    }),
    ...([ 'collection-failure', 'run-failure' ] as const).map(function (scenario) {
        return authoredTest(`retains ${scenario} as a failed run`, async function (scope: TestScope) {
            const fixture = supervisedRunOrchestration(scenario, false, 'buffered');
            const result = await fixture.execute();
            scope.assert.equal(result.status, 'failed');
            scope.assert.true(result.runnerErrors.some(function (error) {
                return error.message.includes('child');
            }));
            scope.assert.equal(fixture.events[0], 'start');
            return scope.assert.collect();
        });
    }),
    authoredTest('propagates child startup failures', async function (scope: TestScope) {
        const fixture = supervisedRunOrchestration('start-failure', false, 'buffered');
        await scope.assert.rejects(fixture.execute, { message: 'child start failed' });
        scope.assert.deepEqual(fixture.events, [ 'start' ]);
        return scope.assert.collect();
    }),
    authoredTest('stops a child after a process budget breach', async function (scope: TestScope) {
        const fixture = supervisedRunOrchestration('budget', false, 'buffered');
        const result = await fixture.execute();
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.some(function (error) {
            return error.message === 'Process budget exceeded: activeResourceCount observed 2, budget 1.';
        }));
        return scope.assert.collect();
    })
]);
