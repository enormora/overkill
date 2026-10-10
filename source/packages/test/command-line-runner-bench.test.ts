import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';

type CapturedCommandLineRun = Awaited<ReturnType<typeof runCommandLine>>;
type BenchmarkVerb = 'list' | 'run';

const emptyTestData = { annotations: {}, controls: {} } as const;
const benchmarkVerbs: readonly BenchmarkVerb[] = [ 'run', 'list' ];

function benchmarkRequests(
    result: CapturedCommandLineRun,
    verb: BenchmarkVerb
): readonly {
    readonly configPath: string | null;
    readonly cwd: string;
    readonly paths: readonly string[];
    readonly profile: string | null;
}[] {
    return verb === 'run'
        ? result.benchmarkRunRequests.map(function commandSelection(request) {
            return {
                configPath: request.configPath,
                cwd: request.cwd,
                paths: request.runRequest.paths,
                profile: request.runRequest.profile
            };
        })
        : result.benchmarkListRequests.map(function commandSelection(request) {
            return {
                configPath: request.configPath,
                cwd: request.cwd,
                paths: request.listRequest.paths,
                profile: request.listRequest.profile
            };
        });
}

function assertBaselineRequest(
    scope: TestScope,
    result: CapturedCommandLineRun,
    verb: 'apply' | 'bootstrap' | 'diff' | 'update'
): void {
    const [ entry ] = result.baselineExecutionRequests;
    scope.require.defined(entry);
    scope.assert.equal(entry.verb, verb);
    scope.assert.deepEqual(entry.request.runRequest.paths, [ 'source/startup.bench.ts' ]);
    scope.assert.equal(entry.request.runRequest.profile, 'startup');
    scope.assert.equal(entry.request.configPath, 'overkill.config.ts');
    scope.assert.equal(result.exitCode, 0);
    scope.assert.deepEqual(result.baselineListRequests, []);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-bench.test.ts',
    ...emptyTestData,
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'benchmark baseline execution verbs carry typed selection requests',
            ...emptyTestData,
            async body(scope: TestScope) {
                for (const verb of [ 'apply', 'bootstrap', 'diff', 'update' ] as const) {
                    const result = await runCommandLine([
                        'bench',
                        'baseline',
                        verb,
                        'source/startup.bench.ts',
                        '--profile',
                        'startup',
                        '--title',
                        'first',
                        '--config',
                        'overkill.config.ts'
                    ], passingResult());
                    assertBaselineRequest(scope, result, verb);
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'benchmark baseline listing accepts disk selection flags only',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'bench', 'baseline', 'list', 'source', '--profile', 'startup' ],
                    passingResult()
                );
                scope.assert.deepEqual(result.baselineListRequests, [ {
                    configPath: null,
                    cwd: '/project',
                    listRequest: { paths: [ 'source' ], profile: 'startup' }
                } ]);
                scope.assert.deepEqual(result.baselineExecutionRequests, []);
                const invalid = await runCommandLine(
                    [ 'bench', 'baseline', 'list', '--title', 'first' ],
                    passingResult()
                );
                scope.assert.equal(invalid.exitCode, 3);
                scope.assert.equal(invalid.runnerLoadCount, 0);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'bench run carries shared selection and execution flags',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await runCommandLine([
                    'bench',
                    'run',
                    '--file',
                    'startup.bench.ts',
                    '--title',
                    'startup',
                    '--filter',
                    'tag=fast',
                    '--runtime',
                    'browser',
                    '--order',
                    'lexical',
                    '--seed',
                    '42',
                    '--shard',
                    '1/2',
                    '--timings',
                    '--workers',
                    '4',
                    '--no-capture',
                    '--resource-budget',
                    'residentSetBytes=1000'
                ], passingResult());
                const request = result.benchmarkRunRequests[0]?.runRequest;
                scope.require.defined(request);
                scope.assert.equal(result.exitCode, 0);
                scope.assert.deepEqual({
                    profile: request.profile,
                    capture: request.capture,
                    workers: request.workers,
                    measureResourceUsage: request.measureResourceUsage,
                    residentSetBytes: request.resourceBudgetOverrides?.residentSetBytes,
                    timingCollection: request.timingCollection,
                    order: request.order,
                    seed: request.seed,
                    shard: request.shard,
                    selectionKind: request.selection.kind
                }, {
                    profile: null,
                    capture: 'live',
                    workers: 4,
                    measureResourceUsage: true,
                    residentSetBytes: 1000,
                    timingCollection: 'precise',
                    order: 'lexical',
                    seed: { value: 42n },
                    shard: { index: 1, total: 2 },
                    selectionKind: 'filter'
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'bench list carries shared selection and display flags',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await runCommandLine([
                    'bench',
                    'list',
                    '--file',
                    'startup.bench.ts',
                    '--title',
                    'startup',
                    '--filter',
                    'tag=fast',
                    '--runtime',
                    'browser',
                    '--order',
                    'lexical',
                    '--seed',
                    '42',
                    '--shard',
                    '1/2',
                    '--with-locations',
                    '--with-orphans'
                ], passingResult());
                const request = result.benchmarkListRequests[0]?.listRequest;
                scope.require.defined(request);
                scope.assert.equal(result.exitCode, 0);
                scope.assert.true(request.withLocations);
                scope.assert.true(request.withOrphans);
                scope.assert.deepEqual(request.shard, { index: 1, total: 2 });
                scope.assert.equal(request.selection.kind, 'filter');
                return scope.assert.collect();
            }
        }),
        ...benchmarkVerbs.flatMap(function createBenchmarkCommandTests(verb) {
            return [
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `bench ${verb} dispatches explicit profile selection`,
                    ...emptyTestData,
                    async body(scope: TestScope) {
                        for (
                            const profileArguments of [
                                [ '--profile', 'cli-cold-start' ],
                                [ '--profile=cli-cold-start' ]
                            ]
                        ) {
                            const result = await runCommandLine([
                                'bench',
                                verb,
                                ...profileArguments,
                                '--config',
                                'policy.ts',
                                '--',
                                '-cold.bench.ts'
                            ], passingResult());

                            scope.assert.deepEqual(benchmarkRequests(result, verb), [ {
                                configPath: 'policy.ts',
                                cwd: '/project',
                                paths: [ '-cold.bench.ts' ],
                                profile: 'cli-cold-start'
                            } ]);
                            scope.assert.equal(result.exitCode, 0);
                        }

                        return scope.assert.collect();
                    }
                }),
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `bench ${verb} dispatches path operands and config`,
                    ...emptyTestData,
                    async body(scope: TestScope) {
                        const scenarios = [
                            { arguments: [ 'bench', verb ], configPath: null, paths: [] },
                            { arguments: [ 'bench', verb, 'a.bench.ts' ], configPath: null, paths: [ 'a.bench.ts' ] },
                            {
                                arguments: [ 'bench', verb, 'b.bench.ts', 'a.bench.ts' ],
                                configPath: null,
                                paths: [ 'b.bench.ts', 'a.bench.ts' ]
                            },
                            {
                                arguments: [ 'bench', verb, '--', '-cold.bench.ts' ],
                                configPath: null,
                                paths: [ '-cold.bench.ts' ]
                            },
                            {
                                arguments: [ '--config', 'policy/config.ts', 'bench', verb, 'a.bench.ts' ],
                                configPath: 'policy/config.ts',
                                paths: [ 'a.bench.ts' ]
                            },
                            {
                                arguments: [ 'bench', '--config', 'policy/config.ts', verb, 'a.bench.ts' ],
                                configPath: 'policy/config.ts',
                                paths: [ 'a.bench.ts' ]
                            },
                            {
                                arguments: [ 'bench', verb, '--config', 'policy/config.ts', 'a.bench.ts' ],
                                configPath: 'policy/config.ts',
                                paths: [ 'a.bench.ts' ]
                            },
                            {
                                arguments: [ 'bench', verb, 'a.bench.ts', '--config=policy/config.ts' ],
                                configPath: 'policy/config.ts',
                                paths: [ 'a.bench.ts' ]
                            }
                        ];

                        for (const scenario of scenarios) {
                            const result = await runCommandLine(scenario.arguments, passingResult());

                            scope.assert.deepEqual(benchmarkRequests(result, verb), [ {
                                paths: scenario.paths,
                                profile: null,
                                configPath: scenario.configPath,
                                cwd: '/project'
                            } ]);
                            scope.assert.equal(benchmarkRequests(result, verb === 'run' ? 'list' : 'run').length, 0);
                            scope.assert.deepEqual({ run: result.runRequests, list: result.listRequests }, {
                                run: [],
                                list: []
                            });
                            scope.assert.equal(result.runnerLoadCount, 1);
                            scope.assert.deepEqual({ returned: result.exitCode, applied: result.exitCodes }, {
                                returned: 0,
                                applied: [ 0 ]
                            });
                            scope.assert.deepEqual({ stdout: result.stdout, stderr: result.stderr }, {
                                stdout: '',
                                stderr: ''
                            });
                        }

                        return scope.assert.collect();
                    }
                }),
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `bench ${verb} delivers the nested command result`,
                    ...emptyTestData,
                    async body(scope: TestScope) {
                        const result = await runCommandLine([ 'bench', verb ], {
                            ...passingResult(),
                            exitCode: 2,
                            fallbackDiagnostics: [ 'benchmark diagnostic', 'terminated diagnostic\n' ],
                            stdoutLines: [ 'workload plan', 'terminated output\n' ]
                        });

                        scope.assert.equal(result.exitCode, 2);
                        scope.assert.deepEqual(result.exitCodes, [ 2 ]);
                        scope.assert.equal(result.stdout, 'workload plan\nterminated output\n');
                        scope.assert.equal(result.stderr, 'benchmark diagnostic\nterminated diagnostic\n');
                        scope.assert.equal(benchmarkRequests(result, verb).length, 1);

                        return scope.assert.collect();
                    }
                }),
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `bench ${verb} reports handler crashes`,
                    ...emptyTestData,
                    async body(scope: TestScope) {
                        const result = await runCommandLine([ 'bench', verb ], new Error('benchmark handler failed'));

                        scope.assert.equal(result.exitCode, 70);
                        scope.assert.deepEqual(result.exitCodes, [ 70 ]);
                        scope.assert.equal(result.stdout, '');
                        scope.assert.equal(result.stderr, 'Overkill internal error: benchmark handler failed\n');
                        scope.assert.equal(benchmarkRequests(result, verb).length, 1);

                        return scope.assert.collect();
                    }
                }),
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `bench ${verb} rejects unsupported flags before loading the runner`,
                    ...emptyTestData,
                    async body(scope: TestScope) {
                        const unsupportedArguments: readonly (readonly [string, ...string[]])[] = [
                            [ '--coverage' ],
                            [ '--record' ],
                            [ '--debug' ],
                            ...(verb === 'run' ? [ [ '--with-locations' ], [ '--with-orphans' ] ] : [
                                [ '--timings' ],
                                [ '--workers', '2' ],
                                [ '--no-capture' ],
                                [ '--measure-resource-usage' ],
                                [ '--resource-budget', 'residentSetBytes=1000' ]
                            ]) as readonly (readonly [string, ...string[]])[]
                        ];

                        for (const flagArguments of unsupportedArguments) {
                            const result = await runCommandLine([ 'bench', verb, ...flagArguments ], passingResult());

                            scope.assert.equal(result.exitCode, 3);
                            scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                            scope.assert.equal(result.runnerLoadCount, 0);
                            scope.assert.equal(result.stdout, '');
                            scope.assert.includes(result.stderr, 'Unknown arguments');
                            scope.assert.includes(result.stderr, flagArguments[0]);
                        }

                        return scope.assert.collect();
                    }
                }),
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `bench ${verb} rejects malformed config arguments before loading the runner`,
                    ...emptyTestData,
                    async body(scope: TestScope) {
                        const malformedConfigArguments = [
                            [ '--config' ],
                            [ '--profile' ],
                            [ '--profile', 'first', '--profile', 'second' ],
                            [ '--config', 'first.config.ts', '--config', 'second.config.ts' ]
                        ];

                        for (const configArguments of malformedConfigArguments) {
                            const result = await runCommandLine([ 'bench', verb, ...configArguments ], passingResult());

                            scope.assert.equal(result.exitCode, 3);
                            scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                            scope.assert.equal(result.runnerLoadCount, 0);
                            scope.assert.equal(result.stdout, '');
                            scope.assert.includes(result.stderr, configArguments[0] ?? '');
                        }

                        return scope.assert.collect();
                    }
                })
            ];
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'benchmark help does not load the runner',
            ...emptyTestData,
            async body(scope: TestScope) {
                const helpArguments = [
                    [ '--help' ],
                    [ 'bench' ],
                    [ 'bench', '--help' ],
                    [ 'bench', 'run', '--help' ],
                    [ 'bench', 'list', '--help' ],
                    [ 'bench', 'baseline' ],
                    [ 'bench', 'baseline', '--help' ],
                    [ 'bench', 'baseline', 'update', '--help' ]
                ];

                for (const args of helpArguments) {
                    const result = await runCommandLine(args, passingResult());

                    scope.assert.equal(result.exitCode, 0);
                    scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                    scope.assert.equal(result.runnerLoadCount, 0);
                    scope.assert.equal(result.stderr, '');
                    scope.assert.includes(result.stdout, 'overkill');
                    scope.assert.includes(result.stdout, 'bench');
                }

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'benchmark namespace rejects unknown verbs before loading the runner',
            ...emptyTestData,
            async body(scope: TestScope) {
                for (const verb of [ 'unknown' ]) {
                    const result = await runCommandLine([ 'bench', verb ], passingResult());

                    scope.assert.equal(result.exitCode, 3);
                    scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                    scope.assert.equal(result.runnerLoadCount, 0);
                    scope.assert.equal(result.stdout, '');
                    scope.assert.includes(result.stderr, 'Not a valid subcommand name');
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
