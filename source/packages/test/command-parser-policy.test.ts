import { table, suite, test } from '@overkill-dev/test';

import { commandParser } from '../../test-support/command-parser.ts';

export const testNode = suite('command parser dispatch policy', [
    table({
        title: 'routes history maintenance commands',
        cases: [
            { verb: 'list', flags: [], dryRun: false, yes: false },
            { verb: 'prune', flags: [ '--dry-run' ], dryRun: true, yes: false },
            { verb: 'compact', flags: [], dryRun: false, yes: false },
            { verb: 'clear', flags: [ '--yes' ], dryRun: false, yes: true }
        ] as const,
        caseTitle(entry) {
            return entry.verb;
        },
        async test(scope) {
            const entry = scope.parameters;

            const fixture = commandParser(null);
            const result = await fixture.dispatch([
                'history',
                entry.verb,
                '--config',
                'project.ts',
                ...entry.flags
            ]);
            scope.assert.partialDeepEqual(result, {
                kind: 'command-result',
                result: { exitCode: 0, stdoutLines: [ `history.${entry.verb}` ] }
            });
            scope.assert.deepEqual(fixture.calls, [ {
                verb: `history.${entry.verb}`,
                request: { cwd: '/project', configPath: 'project.ts', dryRun: entry.dryRun, yes: entry.yes }
            } ]);
            scope.assert.equal(fixture.loads(), 1);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'routes corpus commands with built-in codec defaults',
        cases: [ 'inspect', 'promote', 'migrate' ] as const,
        caseTitle(verb) {
            return verb;
        },
        async test(scope) {
            const verb = scope.parameters;

            const fixture = commandParser(null);
            const result = await fixture.dispatch([ 'corpus', verb, 'input.json' ]);
            scope.assert.equal(result.kind, 'command-result');
            scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
                verb: `corpus.${verb}`,
                request: {
                    cwd: '/project',
                    source: { kind: 'path', path: 'input.json' },
                    codec: { kind: 'built-in' },
                    destination: null
                }
            } ]);
            scope.assert.equal(fixture.loads(), 1);
            return scope.assert.collect();
        }
    }),
    test('maps cache selection and explicit codec export and destination', async function (scope) {
        const fixture = commandParser(null);
        await fixture.dispatch([
            'corpus',
            'migrate',
            'cache.json',
            '--entry',
            'selected',
            '--codec',
            'codec.ts',
            '--codec-export',
            'inputCodec',
            '--to',
            'output.json'
        ]);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            verb: 'corpus.migrate',
            request: {
                source: { kind: 'cache-entry', path: 'cache.json', entryId: 'selected' },
                codec: { kind: 'module', path: 'codec.ts', exportName: 'inputCodec' },
                destination: 'output.json'
            }
        } ]);
        return scope.assert.collect();
    }),
    test('uses the default export when a codec module is supplied alone', async function (scope) {
        const fixture = commandParser(null);
        await fixture.dispatch([ 'corpus', 'inspect', 'input.json', '--codec', 'codec.ts' ]);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            request: { codec: { kind: 'module', path: 'codec.ts', exportName: 'default' } }
        } ]);
        return scope.assert.collect();
    }),
    test('rejects codec export without a module before loading the runner', async function (scope) {
        const fixture = commandParser(null);
        const result = await fixture.dispatch([ 'corpus', 'inspect', 'input.json', '--codec-export', 'input' ]);
        scope.assert.partialDeepEqual(result, {
            kind: 'command-result',
            result: { exitCode: 3, fallbackDiagnostics: [ '--codec-export requires --codec.' ] }
        });
        scope.assert.equal(fixture.loads(), 0);
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    test('routes replay selectors and debug settings', async function (scope) {
        const fixture = commandParser(null);
        const result = await fixture.dispatch([ 'replay', 'selected', '--debug' ]);
        scope.assert.equal(result.kind, 'command-result');
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            verb: 'replay',
            request: { cwd: '/project', configPath: null, arguments: [ 'selected', '--debug' ] }
        } ]);
        return scope.assert.collect();
    }),
    test('routes merge sources without invoking a native runner', async function (scope) {
        const fixture = commandParser(null);
        const result = await fixture.dispatch([ 'merge-results', 'first.json', 'second.json' ]);
        scope.assert.equal(result.kind, 'command-result');
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            verb: 'merge',
            request: { cwd: '/project', configPath: null, paths: [ 'first.json', 'second.json' ] }
        } ]);
        return scope.assert.collect();
    }),
    test('routes calibration through benchmark request defaults', async function (scope) {
        const fixture = commandParser(null);
        const result = await fixture.dispatch([ 'bench', 'calibrate' ]);
        scope.assert.equal(result.kind, 'command-result');
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.calls, [ {
            verb: 'bench.calibrate',
            request: { cwd: '/project', runRequest: { coverage: false, recordForMerge: false } }
        } ]);
        return scope.assert.collect();
    }),
    test('preserves lazy runner failures', async function (scope) {
        const failure = new Error('runner failed');
        const fixture = commandParser(failure);
        await scope.assert.rejects(async function () {
            await fixture.dispatch([ 'history', 'list' ]);
        }, { exact: failure });
        scope.assert.equal(fixture.loads(), 1);
        return scope.assert.collect();
    })
]);
