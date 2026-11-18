import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { commandNamespace } from '../test-support/command-namespace.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';

const context = { cwd: '/project', configPath: null, arguments: [ 'selected' ] };
export const testNode = suite('lazy command namespace routes', [
    test('does not load command families while creating routes', function (scope: TestScope) {
        const fixture = commandNamespace(null);
        scope.assert.deepEqual(fixture.loads, []);
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    ...([ 'list', 'prune', 'compact', 'clear' ] as const).map(function (verb) {
        return test(`loads and forwards history ${verb}`, async function (scope: TestScope) {
            const fixture = commandNamespace(null);
            const request = { cwd: '/project', configPath: null, dryRun: true, yes: false };
            const result = await fixture.commands.history[verb](request);
            scope.assert.deepEqual(fixture.loads, [ 'history' ]);
            scope.assert.deepEqual(fixture.calls, [ { verb: `history.${verb}`, request } ]);
            scope.assert.deepEqual(result.stdoutLines, [ `history.${verb}` ]);
            return scope.assert.collect();
        });
    }),
    ...([ 'inspect', 'promote', 'migrate' ] as const).map(function (verb) {
        return test(`loads and forwards corpus ${verb}`, async function (scope: TestScope) {
            const fixture = commandNamespace(null);
            const request = {
                cwd: '/project',
                source: { kind: 'path' as const, path: 'witness.json' },
                codec: { kind: 'built-in' as const },
                destination: null,
                async writePreview() {
                    throw new Error('Routes must preserve preview ownership.');
                }
            };
            const result = await fixture.commands.corpus[verb](request);
            scope.assert.deepEqual(fixture.loads, [ 'corpus' ]);
            scope.assert.deepEqual(fixture.calls, [ { verb: `corpus.${verb}`, request } ]);
            scope.assert.deepEqual(result.stdoutLines, [ `corpus.${verb}` ]);
            return scope.assert.collect();
        });
    }),
    test('delegates merge requests without loading unrelated families', async function (scope: TestScope) {
        const fixture = commandNamespace(null);
        const request = { cwd: '/project', configPath: null, paths: [ 'first.json', 'second.json' ] };
        await fixture.commands.mergeResults(request);
        scope.assert.deepEqual(fixture.loads, [ 'merge' ]);
        scope.assert.deepEqual(fixture.calls, [ { verb: 'merge', request } ]);
        return scope.assert.collect();
    }),
    ...([ 'replayRun', 'replayWitness' ] as const).map(function (verb) {
        return test(`routes ${verb} through its own lazy dependency`, async function (scope: TestScope) {
            const fixture = commandNamespace(null);
            const result = await fixture.commands[verb](context);
            scope.assert.deepEqual(fixture.loads, [ verb === 'replayRun' ? 'recorded' : 'replay' ]);
            scope.assert.deepEqual(fixture.calls, [ {
                verb: verb === 'replayRun' ? 'recorded' : 'witness',
                request: context
            } ]);
            scope.assert.deepEqual(result.stdoutLines, [ verb === 'replayRun' ? 'recorded' : 'witness' ]);
            return scope.assert.collect();
        });
    }),
    test('routes calibration through benchmark commands', async function (scope: TestScope) {
        const fixture = commandNamespace(null);
        const request = { cwd: '/project', configPath: null, runRequest: defaultRunRequest() };
        await fixture.commands.bench.calibrate(request);
        scope.assert.deepEqual(fixture.loads, [ 'benchmark' ]);
        scope.assert.deepEqual(fixture.calls, [ { verb: 'calibrate', request } ]);
        return scope.assert.collect();
    }),
    test('preserves delegated route failures', async function (scope: TestScope) {
        const failure = new Error('command failed');
        const fixture = commandNamespace(failure);
        await scope.assert.rejects(async function () {
            await fixture.commands.history.list({ cwd: '/project', configPath: null, dryRun: false, yes: false });
        }, { exact: failure });
        scope.assert.deepEqual(fixture.loads, [ 'history' ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
