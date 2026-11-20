import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { ordinaryCommandRouting, ordinaryCommandScenario } from '../test-support/ordinary-command-routing.ts';
import { commandLineExitCodes } from './command-line-command.ts';

export const testNode: TestNode = suite('ordinary baseline command routing', [
    table({
        title: 'routes ordinary commands and reports baseline changes',
        cases: [ 'apply', 'bootstrap', 'diff', 'update' ] as const,
        caseTitle(verb) {
            return `${verb}`;
        },
        async test(scope) {
            const verb = scope.parameters;

            const fixture = ordinaryCommandRouting(ordinaryCommandScenario);
            const result = await fixture.commands[verb](fixture.request);
            scope.assert.equal(
                result.exitCode,
                verb === 'diff' ? commandLineExitCodes.testFailure : commandLineExitCodes.pass
            );
            scope.assert.deepEqual(fixture.calls, [ `${verb}:unit` ]);
            scope.assert.equal(result.stdoutLines[0], 'baseline warning');
            scope.assert.true(result.stdoutLines[1]?.startsWith('create ') === true);
            return scope.assert.collect();
        }
    }),
    test('passes an unchanged baseline diff', async function (scope) {
        const fixture = ordinaryCommandRouting({ ...ordinaryCommandScenario, changes: false });
        const result = await fixture.commands.diff(fixture.request);
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.deepEqual(result.stdoutLines, [ 'baseline warning' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'reports failures through the command result',
        cases: [ 'load', 'execute' ] as const,
        caseTitle(failure) {
            return `${failure}`;
        },
        async test(scope) {
            const failure = scope.parameters;

            const fixture = ordinaryCommandRouting({ ...ordinaryCommandScenario, failure });
            const result = await fixture.commands.apply(fixture.request);
            scope.assert.equal(result.exitCode, commandLineExitCodes.internalCrash);
            scope.assert.equal(result.runResult, null);
            scope.assert.true(result.fallbackDiagnostics.length > 0);
            return scope.assert.collect();
        }
    }),
    test('lists stored baseline identities', async function (scope) {
        const fixture = ordinaryCommandRouting(ordinaryCommandScenario);
        const result = await fixture.commands.list({
            cwd: '/project',
            configPath: null,
            listRequest: { paths: [], profile: 'unit' }
        });
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.true(result.stdoutLines[0]?.startsWith('baselines/snapshot.baseline.json: ') === true);
        scope.assert.deepEqual(fixture.calls, [ 'list' ]);
        return scope.assert.collect();
    }),
    test('reports baseline listing failures', async function (scope) {
        const fixture = ordinaryCommandRouting({ ...ordinaryCommandScenario, failure: 'list' });
        const result = await fixture.commands.list({
            cwd: '/project',
            configPath: null,
            listRequest: { paths: [], profile: 'unit' }
        });
        scope.assert.equal(result.exitCode, commandLineExitCodes.internalCrash);
        scope.assert.deepEqual(result.stdoutLines, []);
        return scope.assert.collect();
    })
]);
