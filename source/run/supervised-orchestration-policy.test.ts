import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { supervisedRunOrchestration } from '../test-support/supervised-run-orchestration.ts';

export const testNode: TestNode = suite('memory supervised run orchestration', [
    test('retains process samples arriving before collection completes', async function (scope) {
        const fixture = supervisedRunOrchestration('collection-sample', false, 'buffered');
        const result = await fixture.execute();
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.deepEqual(fixture.events, [ 'start', 'collect', 'run' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects malformed child protocols',
        cases: [ 'empty-result', 'duplicate-result', 'forbidden-event' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

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
        }
    }),
    table({
        title: 'executes supervised children across timing and capture modes',
        cases: ([ false, true ] as const).flatMap(function (timed) {
            return ([ 'buffered', 'live' ] as const).map(function (capture) {
                return { timed, capture };
            });
        }),
        caseTitle({ timed, capture }) {
            return [ timed, capture ].map(String).join(', ');
        },
        async test(scope) {
            const { timed, capture } = scope.parameters;

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
    }),
    table({
        title: 'retains orchestration failures as failed runs',
        cases: [ 'collection-failure', 'run-failure' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const fixture = supervisedRunOrchestration(scenario, false, 'buffered');
            const result = await fixture.execute();
            scope.assert.equal(result.status, 'failed');
            scope.assert.true(result.runnerErrors.some(function (error) {
                return error.message.includes('child');
            }));
            scope.assert.equal(fixture.events[0], 'start');
            return scope.assert.collect();
        }
    }),
    test('propagates child startup failures', async function (scope) {
        const fixture = supervisedRunOrchestration('start-failure', false, 'buffered');
        await scope.assert.rejects(fixture.execute, { message: 'child start failed' });
        scope.assert.deepEqual(fixture.events, [ 'start' ]);
        return scope.assert.collect();
    }),
    test('stops a child after a process budget breach', async function (scope) {
        const fixture = supervisedRunOrchestration('budget', false, 'buffered');
        const result = await fixture.execute();
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.some(function (error) {
            return error.message === 'Process budget exceeded: activeResourceCount observed 2, budget 1.';
        }));
        return scope.assert.collect();
    })
]);
