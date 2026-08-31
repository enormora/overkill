import { createSuite, createTestCase, runIfMain, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import type {
    CommandLineCommand,
    CommandLineExitCode,
    CommandLineListTestsRequest,
    CommandLineRunTestsRequest,
    CommandLineRunner,
    CommandLineRunnerResult
} from '../run/command-line.entry-point.ts';
import { runOverkillCommandLine } from './command-line-runner.ts';

type CapturedOutput = {
    readonly chunks: readonly string[];
    readonly output: {
        readonly write: (chunk: string) => unknown;
    };
};

type RecordedExitCodes = {
    readonly values: readonly number[];
    readonly apply: (exitCode: number) => void;
};

type RequestRecorder = {
    readonly recordList: (commandLineRequest: CommandLineListTestsRequest) => void;
    readonly recordRun: (commandLineRequest: CommandLineRunTestsRequest) => void;
};

const unexpectedCommand: CommandLineCommand = async function runUnexpectedCommand() {
    throw new Error('Unexpected command.');
};

const testExitCodes: {
    readonly pass: CommandLineExitCode;
    readonly runnerError: CommandLineExitCode;
} = {
    pass: 0,
    runnerError: 2
};

function passingResult(): CommandLineRunnerResult {
    return {
        exitCode: testExitCodes.pass,
        fallbackDiagnostics: [],
        runResult: null,
        stdoutLines: []
    };
}

function createCapturedOutput(): CapturedOutput {
    const chunks: string[] = [];

    return {
        chunks,
        output: {
            write(chunk) {
                chunks.push(chunk);
            }
        }
    };
}

function createRecordedExitCodes(): RecordedExitCodes {
    const values: number[] = [];

    return {
        values,
        apply(exitCode) {
            values.push(exitCode);
        }
    };
}

function createRunner(
    requestRecorder: RequestRecorder,
    result: CommandLineRunnerResult
): CommandLineRunner {
    return {
        baseline: {
            apply: unexpectedCommand,
            bootstrap: unexpectedCommand,
            diff: unexpectedCommand,
            list: unexpectedCommand,
            update: unexpectedCommand
        },
        bench: {
            baseline: {
                apply: unexpectedCommand,
                bootstrap: unexpectedCommand,
                diff: unexpectedCommand,
                list: unexpectedCommand,
                update: unexpectedCommand
            },
            listBenchmarks: unexpectedCommand,
            runBenchmarks: unexpectedCommand
        },
        async listTests(request) {
            requestRecorder.recordList(request);

            return result;
        },
        replayRun: unexpectedCommand,
        replayWitness: unexpectedCommand,
        async runTests(request) {
            requestRecorder.recordRun(request);

            return result;
        }
    };
}

async function runCommandLine(
    args: readonly string[],
    runnerResult: CommandLineRunnerResult
): Promise<{
    readonly exitCodes: readonly number[];
    readonly listRequests: readonly CommandLineListTestsRequest[];
    readonly runRequests: readonly CommandLineRunTestsRequest[];
    readonly stderr: string;
    readonly stdout: string;
}> {
    const stdout = createCapturedOutput();
    const stderr = createCapturedOutput();
    const exitCodes = createRecordedExitCodes();
    const listRequests: CommandLineListTestsRequest[] = [];
    const runRequests: CommandLineRunTestsRequest[] = [];

    await runOverkillCommandLine({
        arguments: args,
        applyExitCode: exitCodes.apply,
        cwd: '/project',
        async loadRunner() {
            return createRunner({
                recordList(request) {
                    listRequests.push(request);
                },
                recordRun(request) {
                    runRequests.push(request);
                }
            }, runnerResult);
        },
        stderr: stderr.output,
        stdout: stdout.output
    });

    return {
        exitCodes: exitCodes.values,
        listRequests,
        runRequests,
        stderr: stderr.chunks.join(''),
        stdout: stdout.chunks.join('')
    };
}

export const testSuite = createSuite({
    name: 'source/packages/test/command-line-runner.test.ts',
    metadata: {},
    children: [
        createTestCase({
            name: 'overkill wrapper parses explicit run paths',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'run', 'source/a.test.ts', 'source/b.test.ts' ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.assert.equal(result.stderr, '');
                scope.assert.equal(result.stdout, '');
                scope.assert.deepEqual(result.runRequests, [
                    {
                        configPath: null,
                        cwd: '/project',
                        runRequest: {
                            baselineUpdateMode: 'none',
                            capabilityRestrictions: { mode: 'enabled' },
                            capture: 'buffered',
                            debug: {
                                mode: 'off',
                                selectors: []
                            },
                            execution: { mode: 'profile-default' },
                            measureResourceUsage: null,
                            order: 'plan',
                            paths: [ 'source/a.test.ts', 'source/b.test.ts' ],
                            profile: 'microtest',
                            resourceBudgetOverrides: null,
                            resourceUsageSamplingIntervalMilliseconds: null,
                            seed: { value: null },
                            selection: { kind: 'all' },
                            shard: { index: 0, total: 1 },
                            verbose: false
                        }
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper parses explicit list paths',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [
                        '--config',
                        'overkill.config.ts',
                        'list',
                        '--profile=backend-http',
                        '--with-locations',
                        '--with-orphans',
                        'source/a.test.ts',
                        'source/b.test.ts'
                    ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.assert.deepEqual(result.runRequests, []);
                scope.assert.deepEqual(result.listRequests, [
                    {
                        configPath: 'overkill.config.ts',
                        cwd: '/project',
                        listRequest: {
                            paths: [ 'source/a.test.ts', 'source/b.test.ts' ],
                            profile: 'backend-http',
                            selection: { kind: 'all' },
                            withLocations: true,
                            withOrphans: true
                        }
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper writes list stdout lines',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'list', 'source/a.test.ts' ], {
                    exitCode: 0,
                    fallbackDiagnostics: [],
                    runResult: null,
                    stdoutLines: [ 'source/a.test.ts', '  suite', '    passes' ]
                });

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.assert.equal(result.stdout, 'source/a.test.ts\n  suite\n    passes\n');
                scope.assert.equal(result.stderr, '');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper maps unsupported list flags to argument errors',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'list', '--resource-budget', 'activeResourceCount=8', 'source/a.test.ts' ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.listRequests.length, 0);
                scope.assert.equal(result.stdout, '');
                scope.assert.true(result.stderr.includes('Unknown arguments'));
                scope.assert.true(result.stderr.includes('--resource-budget'));

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper parses config and profile flags',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ '--config', 'overkill.config.ts', 'run', '--profile=backend-http', 'source/a.test.ts' ],
                    passingResult()
                );
                const [ commandLineRequest ] = result.runRequests;

                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.configPath, 'overkill.config.ts');
                scope.assert.equal(commandLineRequest.runRequest.profile, 'backend-http');
                scope.assert.deepEqual(commandLineRequest.runRequest.paths, [ 'source/a.test.ts' ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper parses resource usage flags',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [
                        'run',
                        '--measure-resource-usage',
                        '--resource-budget',
                        'activeResourceCount=8',
                        '--resource-budget=javaScriptEngineHeapBytes=100',
                        'source/a.test.ts'
                    ],
                    passingResult()
                );
                const [ commandLineRequest ] = result.runRequests;

                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.runRequest.measureResourceUsage, true);
                const { resourceBudgetOverrides } = commandLineRequest.runRequest;

                scope.require.notNull(resourceBudgetOverrides);
                scope.assert.deepEqual(resourceBudgetOverrides, {
                    activeResourceCount: 8,
                    javaScriptEngineHeapBytes: 100,
                    residentSetBytes: null,
                    residentSetGrowthBytesPerSecond: null
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper resource budget enables measurement',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'run', '--resource-budget', 'residentSetBytes=200', 'source/a.test.ts' ],
                    passingResult()
                );
                const [ commandLineRequest ] = result.runRequests;

                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.runRequest.measureResourceUsage, true);
                const { resourceBudgetOverrides } = commandLineRequest.runRequest;

                scope.require.notNull(resourceBudgetOverrides);
                scope.assert.deepEqual(resourceBudgetOverrides, {
                    activeResourceCount: null,
                    javaScriptEngineHeapBytes: null,
                    residentSetBytes: 200,
                    residentSetGrowthBytesPerSecond: null
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper preserves path operands after delimiter',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', '--', '--seed' ], passingResult());
                const [ commandLineRequest ] = result.runRequests;

                scope.require.defined(commandLineRequest);
                scope.assert.deepEqual(commandLineRequest.runRequest.paths, [ '--seed' ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper writes fallback diagnostics and applies run exit code',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', 'source/a.test.ts' ], {
                    exitCode: testExitCodes.runnerError,
                    fallbackDiagnostics: [ 'Overkill runner error: A', 'Overkill runner error: B' ],
                    runResult: null,
                    stdoutLines: []
                });

                scope.assert.deepEqual(result.exitCodes, [ 2 ]);
                scope.assert.equal(
                    result.stderr,
                    'Overkill runner error: A\nOverkill runner error: B\n'
                );

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper parses run selectors',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [
                        'run',
                        '--filter',
                        'tag=fast !tag=flaky',
                        '--name',
                        'Login',
                        '--file',
                        'source/auth.test.ts'
                    ],
                    passingResult()
                );
                const [ commandLineRequest ] = result.runRequests;

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.require.defined(commandLineRequest);
                scope.assert.deepEqual(commandLineRequest.runRequest.selection, {
                    filter: {
                        filters: [
                            {
                                filters: [
                                    { field: 'tag', kind: 'equals', value: 'fast' },
                                    {
                                        filter: { field: 'tag', kind: 'equals', value: 'flaky' },
                                        kind: 'not'
                                    }
                                ],
                                kind: 'all'
                            },
                            { field: 'name', kind: 'contains', value: 'Login' },
                            { field: 'file', kind: 'equals', value: 'source/auth.test.ts' }
                        ],
                        kind: 'all'
                    },
                    kind: 'filter'
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper parses list selectors',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'list', '--filter', 'tag=fast | tag=slow', '--name', 'Login' ],
                    passingResult()
                );
                const [ commandLineRequest ] = result.listRequests;

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.require.defined(commandLineRequest);
                scope.assert.deepEqual(commandLineRequest.listRequest.selection, {
                    filter: {
                        filters: [
                            {
                                filters: [
                                    { field: 'tag', kind: 'equals', value: 'fast' },
                                    { field: 'tag', kind: 'equals', value: 'slow' }
                                ],
                                kind: 'any'
                            },
                            { field: 'name', kind: 'contains', value: 'Login' }
                        ],
                        kind: 'all'
                    },
                    kind: 'filter'
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper rejects malformed run filters',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'run', '--filter', 'kind=microtest' ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.runRequests.length, 0);
                scope.assert.equal(result.stdout, '');
                scope.assert.true(result.stderr.includes('Unknown run filter dimension: kind'));

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper rejects duplicate resource budget names',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [
                        'run',
                        '--resource-budget',
                        'activeResourceCount=8',
                        '--resource-budget',
                        'activeResourceCount=9'
                    ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.runRequests.length, 0);
                scope.assert.true(result.stderr.includes('Duplicate resource budget name: activeResourceCount'));

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper rejects unknown resource budget names',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'run', '--resource-budget', 'heap=8' ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.runRequests.length, 0);
                scope.assert.true(result.stderr.includes('Unknown resource budget name: heap'));

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'overkill wrapper prints help without running tests',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ '--help' ], passingResult());

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.assert.equal(result.runRequests.length, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.true(result.stdout.includes('overkill <subcommand>'));

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
