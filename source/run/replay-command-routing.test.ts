import { table, suite, test } from '@overkill-dev/test';

import { replayCommandRouting } from '../test-support/replay-command-routing.ts';

import { commandLineExitCodes } from './command-line-command.ts';

export const testNode = suite('replay command operands and delivery', [
    test('routes retained run ids and includes maintenance diagnostics', async function (scope) {
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
    test('routes witness paths with their explicit profile', async function (scope) {
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
    table({
        title: 'rejects invalid replay operand counts before execution',
        cases: [ 'replayRun', 'replayWitness' ] as const,
        caseTitle(verb) {
            return verb;
        },
        async test(scope) {
            const verb = scope.parameters;

            const fixture = replayCommandRouting('none');
            const result = await fixture.commands[verb]({ ...fixture.context, arguments: [] });
            scope.assert.equal(result.exitCode, commandLineExitCodes.argumentOrConfig);
            scope.assert.deepEqual(fixture.calls, []);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'reports replay failures',
        cases: [ 'load', 'execute' ] as const,
        caseTitle(failure) {
            return failure;
        },
        async test(scope) {
            const failure = scope.parameters;

            const fixture = replayCommandRouting(failure);
            const result = await fixture.commands.replayRun(fixture.context);
            scope.assert.equal(result.exitCode, commandLineExitCodes.internalCrash);
            scope.assert.equal(result.runResult, null);
            scope.assert.true(result.fallbackDiagnostics.length > 0);
            return scope.assert.collect();
        }
    }),
    test('forwards parsed debug selection without changing replay operands', async function (scope) {
        const fixture = replayCommandRouting('none');
        const result = await fixture.commands.replayRun({ ...fixture.context, arguments: [ '--debug', 'run' ] });
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            command: { runId: 'run', debug: { mode: 'all' } }
        } ]);
        return scope.assert.collect();
    })
]);
