import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { replayCommandRouting } from '../test-support/replay-command-routing.ts';
import { testNode as witnessPreparation } from './witness-replay-preparation-policy.test.ts';
import { commandLineExitCodes } from './command-line-command.ts';

export const testNode = authoredSuite('replay command operands and delivery', [
    witnessPreparation,
    authoredTest('routes retained run ids and includes maintenance diagnostics', async function (scope: TestScope) {
        const fixture = replayCommandRouting('none');
        const result = await fixture.commands.replayRun(fixture.context);
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.deepEqual(result.fallbackDiagnostics, [ 'maintenance diagnostic' ]);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            kind: 'record',
            command: { runId: 'run', cwd: '/project', signal: null }
        } ]);
        return scope.assert.collect();
    }),
    authoredTest('routes witness paths with their explicit profile', async function (scope: TestScope) {
        const fixture = replayCommandRouting('none');
        const result = await fixture.commands.replayWitness({
            ...fixture.context,
            arguments: [ 'witness.json', 'unit' ]
        });
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            kind: 'witness',
            command: { path: 'witness.json', profile: 'unit' }
        } ]);
        return scope.assert.collect();
    }),
    ...([ 'replayRun', 'replayWitness' ] as const).map(function (verb) {
        return authoredTest(
            `rejects invalid ${verb} operand counts before execution`,
            async function (scope: TestScope) {
                const fixture = replayCommandRouting('none');
                const result = await fixture.commands[verb]({ ...fixture.context, arguments: [] });
                scope.assert.equal(result.exitCode, commandLineExitCodes.argumentOrConfig);
                scope.assert.deepEqual(fixture.calls, []);
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'load', 'execute' ] as const).map(function (failure) {
        return authoredTest(`reports replay ${failure} failures`, async function (scope: TestScope) {
            const fixture = replayCommandRouting(failure);
            const result = await fixture.commands.replayRun(fixture.context);
            scope.assert.equal(result.exitCode, commandLineExitCodes.internalCrash);
            scope.assert.equal(result.runResult, null);
            scope.assert.true(result.fallbackDiagnostics.length > 0);
            return scope.assert.collect();
        });
    }),
    authoredTest('forwards parsed debug selection without changing replay operands', async function (scope: TestScope) {
        const fixture = replayCommandRouting('none');
        const result = await fixture.commands.replayRun({ ...fixture.context, arguments: [ '--debug', 'run' ] });
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            command: { runId: 'run', debug: { mode: 'all' } }
        } ]);
        return scope.assert.collect();
    })
]);
