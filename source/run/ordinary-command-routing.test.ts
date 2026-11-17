import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { ordinaryCommandRouting, ordinaryCommandScenario } from '../test-support/ordinary-command-routing.ts';
import { commandLineExitCodes } from './command-line-command.ts';

export const testNode = suite('ordinary baseline command routing', [
    ...([ 'apply', 'bootstrap', 'diff', 'update' ] as const).map(function (verb) {
        return test(`routes ${verb} and reports baseline changes`, async function (scope: TestScope) {
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
        });
    }),
    test('passes an unchanged baseline diff', async function (scope: TestScope) {
        const fixture = ordinaryCommandRouting({ ...ordinaryCommandScenario, changes: false });
        const result = await fixture.commands.diff(fixture.request);
        scope.assert.equal(result.exitCode, commandLineExitCodes.pass);
        scope.assert.deepEqual(result.stdoutLines, [ 'baseline warning' ]);
        return scope.assert.collect();
    }),
    ...([ 'load', 'execute' ] as const).map(function (failure) {
        return test(`reports ${failure} failures through the command result`, async function (scope: TestScope) {
            const fixture = ordinaryCommandRouting({ ...ordinaryCommandScenario, failure });
            const result = await fixture.commands.apply(fixture.request);
            scope.assert.equal(result.exitCode, commandLineExitCodes.internalCrash);
            scope.assert.equal(result.runResult, null);
            scope.assert.true(result.fallbackDiagnostics.length > 0);
            return scope.assert.collect();
        });
    }),
    test('lists stored baseline identities', async function (scope: TestScope) {
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
    test('reports baseline listing failures', async function (scope: TestScope) {
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
await runIfMain(import.meta, testNode);
