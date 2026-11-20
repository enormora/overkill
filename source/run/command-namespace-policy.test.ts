import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { commandNamespace } from '../test-support/command-namespace.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';

const context = { cwd: '/project', configPath: null, arguments: [ 'selected' ] };
export const testNode: TestNode = suite('lazy command namespace routes', [
    test('does not load command families while creating routes', function (scope) {
        const fixture = commandNamespace(null);
        scope.assert.deepEqual(fixture.loads, []);
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    table({
        title: 'loads and forwards history commands',
        cases: [ 'list', 'prune', 'compact', 'clear' ] as const,
        caseTitle(verb) {
            return verb;
        },
        async test(scope) {
            const verb = scope.parameters;

            const fixture = commandNamespace(null);
            const request = { cwd: '/project', configPath: null, dryRun: true, yes: false };
            const result = await fixture.commands.history[verb](request);
            scope.assert.deepEqual(fixture.loads, [ 'history' ]);
            scope.assert.deepEqual(fixture.calls, [ { verb: `history.${verb}`, request } ]);
            scope.assert.deepEqual(result.stdoutLines, [ `history.${verb}` ]);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'loads and forwards corpus commands',
        cases: [ 'inspect', 'promote', 'migrate' ] as const,
        caseTitle(verb) {
            return verb;
        },
        async test(scope) {
            const verb = scope.parameters;

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
        }
    }),
    test('delegates merge requests without loading unrelated families', async function (scope) {
        const fixture = commandNamespace(null);
        const request = { cwd: '/project', configPath: null, paths: [ 'first.json', 'second.json' ] };
        await fixture.commands.mergeResults(request);
        scope.assert.deepEqual(fixture.loads, [ 'merge' ]);
        scope.assert.deepEqual(fixture.calls, [ { verb: 'merge', request } ]);
        return scope.assert.collect();
    }),
    table({
        title: 'routes commands through their own lazy dependencies',
        cases: [ 'replayRun', 'replayWitness' ] as const,
        caseTitle(verb) {
            return verb;
        },
        async test(scope) {
            const verb = scope.parameters;

            const fixture = commandNamespace(null);
            const result = await fixture.commands[verb](context);
            scope.assert.deepEqual(fixture.loads, [ verb === 'replayRun' ? 'recorded' : 'replay' ]);
            scope.assert.deepEqual(fixture.calls, [ {
                verb: verb === 'replayRun' ? 'recorded' : 'witness',
                request: context
            } ]);
            scope.assert.deepEqual(result.stdoutLines, [ verb === 'replayRun' ? 'recorded' : 'witness' ]);
            return scope.assert.collect();
        }
    }),
    test('routes calibration through benchmark commands', async function (scope) {
        const fixture = commandNamespace(null);
        const request = { cwd: '/project', configPath: null, runRequest: defaultRunRequest() };
        await fixture.commands.bench.calibrate(request);
        scope.assert.deepEqual(fixture.loads, [ 'benchmark' ]);
        scope.assert.deepEqual(fixture.calls, [ { verb: 'calibrate', request } ]);
        return scope.assert.collect();
    }),
    test('preserves delegated route failures', async function (scope) {
        const failure = new Error('command failed');
        const fixture = commandNamespace(failure);
        await scope.assert.rejects(async function () {
            await fixture.commands.history.list({ cwd: '/project', configPath: null, dryRun: false, yes: false });
        }, { exact: failure });
        scope.assert.deepEqual(fixture.loads, [ 'history' ]);
        return scope.assert.collect();
    })
]);
