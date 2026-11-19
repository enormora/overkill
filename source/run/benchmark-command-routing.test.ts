import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { benchmarkCommandRouting } from '../test-support/benchmark-command-routing.ts';
import { commandLineExitCodes } from './command-line-command.ts';
import { runBenchmarkBaselineCommand, listBenchmarkBaselineCommand } from './benchmark-baseline-commands.ts';

export const testNode = authoredSuite('benchmark command routing', [
    authoredTest('routes benchmark execution with the selected profile', async function (scope: TestScope) {
        const fixture = benchmarkCommandRouting(null);
        const result = await fixture.commands.runBenchmarks(fixture.request);
        scope.assert.equal(result.exitCode, 0);
        scope.assert.deepEqual(
            fixture.calls.map(function (call) {
                return { verb: call.verb, profile: call.profile };
            }),
            [ { verb: 'run', profile: 'bench' } ]
        );
        scope.assert.equal(result.runResult?.status, 'passed');
        return scope.assert.collect();
    }),
    authoredTest('prints captured reference paths after calibration', async function (scope: TestScope) {
        const fixture = benchmarkCommandRouting(null);
        const result = await fixture.commands.calibrate(fixture.request);
        scope.assert.equal(result.exitCode, 0);
        scope.assert.deepEqual(result.stdoutLines, [ 'Captured calibration reference calibration/reference.json' ]);
        scope.assert.deepEqual(
            fixture.calls.map(function (call) {
                return call.verb;
            }),
            [ 'calibrate' ]
        );
        return scope.assert.collect();
    }),
    ...([ 'runBenchmarks', 'listBenchmarks', 'calibrate' ] as const).map(function (verb) {
        return authoredTest(`${verb} reports loader failures before dispatch`, async function (scope: TestScope) {
            const fixture = benchmarkCommandRouting(new Error('Cannot load policy.'));
            const result = verb === 'listBenchmarks'
                ? await fixture.commands.listBenchmarks({
                    configPath: null,
                    cwd: '/project',
                    listRequest: {
                        profile: 'bench',
                        paths: [],
                        order: 'seeded',
                        seed: fixture.request.runRequest.seed,
                        selection: { kind: 'all' },
                        shard: { index: 1, total: 1 },
                        withLocations: false,
                        withOrphans: false,
                        lastFailed: false
                    }
                })
                : await fixture.commands[verb](fixture.request);
            scope.assert.equal(result.exitCode, commandLineExitCodes.internalCrash);
            scope.assert.includes(result.fallbackDiagnostics.join('\n'), 'Cannot load policy.');
            scope.assert.deepEqual(fixture.calls, []);
            return scope.assert.collect();
        });
    }),
    ...([ 'apply', 'bootstrap', 'diff', 'update' ] as const).map(function (verb) {
        return authoredTest(`routes baseline ${verb} and renders changes`, async function (scope: TestScope) {
            const fixture = benchmarkCommandRouting(null);
            const result = await runBenchmarkBaselineCommand({
                dependencies: fixture.dependencies,
                request: fixture.request,
                verb
            });
            scope.assert.equal(result.exitCode, verb === 'diff' ? 1 : 0);
            scope.assert.includes(result.stdoutLines.join('\n'), 'startup; duration; unit-host');
            scope.assert.true(result.stdoutLines.includes('write calibration/reference.json'));
            scope.assert.deepEqual(
                fixture.calls.map(function (call) {
                    return { verb: call.verb, profile: call.profile };
                }),
                [ { verb, profile: 'bench' } ]
            );
            return scope.assert.collect();
        });
    }),
    authoredTest('lists stored benchmark baseline identities', async function (scope: TestScope) {
        const fixture = benchmarkCommandRouting(null);
        const result = await listBenchmarkBaselineCommand({
            dependencies: fixture.dependencies,
            request: { configPath: null, cwd: '/project', listRequest: { profile: 'bench', paths: [] } }
        });
        scope.assert.equal(result.exitCode, 0);
        scope.assert.includes(result.stdoutLines.join('\n'), 'baselines/performance/reference.benchmark.json:');
        scope.assert.includes(result.stdoutLines.join('\n'), 'startup; duration; unit-host');
        return scope.assert.collect();
    }),
    authoredTest(
        'reports baseline execution and listing failures through command diagnostics',
        async function (scope: TestScope) {
            const fixture = benchmarkCommandRouting(new Error('Cannot load baseline policy.'));
            const run = await runBenchmarkBaselineCommand({
                dependencies: fixture.dependencies,
                request: fixture.request,
                verb: 'diff'
            });
            const list = await listBenchmarkBaselineCommand({
                dependencies: fixture.dependencies,
                request: { configPath: null, cwd: '/project', listRequest: { profile: 'bench', paths: [] } }
            });
            scope.assert.deepEqual([ run.exitCode, list.exitCode ], [
                commandLineExitCodes.internalCrash,
                commandLineExitCodes.internalCrash
            ]);
            scope.assert.includes(run.fallbackDiagnostics.join('\n'), 'Cannot load baseline policy.');
            scope.assert.includes(list.fallbackDiagnostics.join('\n'), 'Cannot load baseline policy.');
            return scope.assert.collect();
        }
    )
]);
