import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine, testExitCodes } from '../../test-support/command-line-test-driver.ts';

const emptyTestData = { annotations: {}, controls: {} } as const;

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner.test.ts',
    ...emptyTestData,
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses explicit run paths',
            ...emptyTestData,
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
                            coverage: false,
                            debug: {
                                mode: 'off',
                                selectors: []
                            },
                            execution: { mode: 'profile-default' },
                            measureResourceUsage: null,
                            order: 'seeded',
                            paths: [ 'source/a.test.ts', 'source/b.test.ts' ],
                            profile: 'microtest',
                            resourceBudgetOverrides: null,
                            resourceUsageSamplingIntervalMilliseconds: null,
                            seed: { value: null },
                            selection: { kind: 'all' },
                            shard: { index: 1, total: 1 },
                            timingCollection: 'profile-default',
                            verbose: false,
                            workers: null
                        }
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses explicit list paths',
            ...emptyTestData,
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
                            order: 'seeded',
                            paths: [ 'source/a.test.ts', 'source/b.test.ts' ],
                            profile: 'backend-http',
                            seed: { value: null },
                            selection: { kind: 'all' },
                            shard: { index: 1, total: 1 },
                            withLocations: true,
                            withOrphans: true
                        }
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper writes list stdout lines',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper maps unsupported list flags to argument errors',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses config and profile flags',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects malformed config arguments before runner loading',
            ...emptyTestData,
            async body(scope: TestScope) {
                for (const verb of [ 'run', 'list' ]) {
                    for (
                        const configArguments of [
                            [ '--config' ],
                            [ '--config', 'first.config.ts', '--config', 'second.config.ts' ]
                        ]
                    ) {
                        const result = await runCommandLine([ verb, ...configArguments ], passingResult());

                        scope.assert.equal(result.exitCode, 3);
                        scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                        scope.assert.equal(result.runnerLoadCount, 0);
                        scope.assert.equal(result.stdout, '');
                        scope.assert.includes(result.stderr, '--config');
                    }
                }

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses resource usage flags',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper resource budget enables measurement',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper preserves path operands after delimiter',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', '--', '--seed' ], passingResult());
                const [ commandLineRequest ] = result.runRequests;

                scope.require.defined(commandLineRequest);
                scope.assert.deepEqual(commandLineRequest.runRequest.paths, [ '--seed' ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper writes fallback diagnostics and applies run exit code',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses run selectors',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [
                        'run',
                        '--filter',
                        'tag=fast !tag=flaky',
                        '--title',
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
                            { field: 'title', kind: 'contains', value: 'Login' },
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses list selectors',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'list', '--filter', 'tag=fast | tag=slow', '--title', 'Login' ],
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
                            { field: 'title', kind: 'contains', value: 'Login' }
                        ],
                        kind: 'all'
                    },
                    kind: 'filter'
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects malformed run filters',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects duplicate resource budget names',
            ...emptyTestData,
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
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects unknown resource budget names',
            ...emptyTestData,
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
