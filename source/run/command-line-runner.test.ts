import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { ReporterSinkConflictError, type Reporter } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from './command-line-runner.ts';
import type { RunCommand, RunOrchestrator, RunRequest } from './run.ts';
import { RunResolutionError } from './run-errors.ts';
import { RunConfigError, type LoadedRunConfig } from './run-config.ts';

type PlainOutputIntent = {
    readonly text: string;
};

const plainOutputRenderer = {
    render(intent: PlainOutputIntent): string {
        return intent.text;
    }
};

const memoryReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'memory',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'memory' } ]
};

const terminalReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'terminal',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'stdout-raw' } ]
};

const defaultRequest: RunRequest = {
    baselineUpdateMode: 'none',
    capture: 'buffered',
    coverage: false,
    debug: {
        mode: 'off',
        selectors: []
    },
    execution: { mode: 'concurrent-in-process' },
    measureResourceUsage: null,
    order: 'plan',
    paths: [],
    profile: 'microtest',
    resourceBudgetOverrides: null,
    resourceUsageSamplingIntervalMilliseconds: null,
    seed: { value: 42n },
    selection: { kind: 'all' },
    shard: { index: 0, total: 1 },
    verbose: false
};

function defaultLoadedConfig(reporters: LoadedRunConfig['reporters']): LoadedRunConfig {
    return {
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: plainOutputRenderer,
        profiles: {
            microtest: {
                measureResourceUsage: false,
                resourceBudgets: {
                    activeResourceCount: null,
                    javaScriptEngineHeapBytes: null,
                    residentSetBytes: null,
                    residentSetGrowthBytesPerSecond: null
                },
                resourceUsageSamplingIntervalMilliseconds: 100
            }
        },
        reporters,
        runtimeStateDir: '.overkill'
    };
}

function createPassingPlan(): TestPlan {
    const engine = createTestEngine();

    return engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    body(scope) {
                        scope.assert.true(true);
                        return scope.assert.collect();
                    },
                    metadata: {},
                    name: 'passes'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );
}

function createRunnerDependencies(
    overrides: Partial<CommandLineRunnerDependencies>
): CommandLineRunnerDependencies {
    const orchestrator: RunOrchestrator = {
        async resolve(command) {
            return {
                config: command.config,
                facts: {
                    cases: [],
                    environment: {
                        node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                        runtimeStateDir: command.config.runtimeStateDir
                    },
                    execution: {
                        baselineUpdateMode: command.request.baselineUpdateMode,
                        capture: command.request.capture,
                        coverage: command.request.coverage,
                        debug: command.request.debug,
                        mode: command.request.execution.mode,
                        order: command.request.order,
                        profile: command.request.profile,
                        resourceUsagePolicy: command.config.profiles.microtest,
                        verbose: command.request.verbose
                    },
                    loader: command.config.loader,
                    reproducibility: {
                        seed: '42',
                        shard: command.request.shard
                    }
                },
                reporters: command.config.reporters,
                request: command.request,
                testPlan: createPassingPlan()
            };
        },
        async run() {
            return runResultFactory.build({
                perTest: [ { outcome: { kind: 'pass' } } ],
                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
            });
        }
    };

    return {
        async createDefaultReporter() {
            return memoryReporter;
        },
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        async loadRunConfig() {
            return defaultLoadedConfig(null);
        },
        orchestrator,
        ...overrides
    };
}

async function runTests(dependencies: CommandLineRunnerDependencies): Promise<CommandLineRunnerResult> {
    const runner = createCommandLineRunner(dependencies);

    return await runner.runTests({
        configPath: null,
        cwd: process.cwd(),
        request: defaultRequest
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-runner.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() injects the default reporter when config omits reporters',
            metadata: {},
            async body(scope: OverkillScope) {
                const receivedCommands: RunCommand[] = [];
                const dependencies = createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run(command) {
                            receivedCommands.push(command);
                            return runResultFactory.build({
                                perTest: [ { outcome: { kind: 'pass' } } ],
                                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
                            });
                        }
                    }
                });
                const result = await runTests(dependencies);

                scope.assert.equal(result.exitCode, 0);
                scope.require.defined(receivedCommands[0]);
                scope.assert.equal(receivedCommands[0].config.reporters[0], memoryReporter);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() preserves configured reporters',
            metadata: {},
            async body(scope: OverkillScope) {
                const receivedCommands: RunCommand[] = [];
                let defaultReporterLoadCount = 0;
                const dependencies = createRunnerDependencies({
                    async createDefaultReporter() {
                        defaultReporterLoadCount += 1;
                        return memoryReporter;
                    },
                    async loadRunConfig() {
                        return defaultLoadedConfig([ terminalReporter ]);
                    },
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run(command) {
                            receivedCommands.push(command);
                            return runResultFactory.build({
                                perTest: [ { outcome: { kind: 'pass' } } ],
                                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
                            });
                        }
                    }
                });
                const result = await runTests(dependencies);

                scope.assert.equal(result.exitCode, 0);
                scope.assert.equal(defaultReporterLoadCount, 0);
                scope.require.defined(receivedCommands[0]);
                scope.assert.equal(receivedCommands[0].config.reporters[0], terminalReporter);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps test failures to exit code 1',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            return runResultFactory.build({
                                perTest: [ { outcome: { kind: 'fail' } } ],
                                summary: { defined: 1, discovered: 1, failed: 1, planned: 1 }
                            });
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps no planned tests to exit code 4',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            return runResultFactory.build({
                                summary: { defined: 0, discovered: 0, planned: 0 }
                            });
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 4);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps runner errors to exit code 2 with fallback diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            return runResultFactory.build({
                                runnerErrors: [ { message: 'Loader failed.', subtype: 'loader' } ],
                                summary: { defined: 1, discovered: 1, planned: 1 }
                            });
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, [ 'Overkill runner error: Loader failed.' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() only falls back to reporter errors when a terminal reporter exists',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    async loadRunConfig() {
                        return defaultLoadedConfig([ terminalReporter ]);
                    },
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            return runResultFactory.build({
                                runnerErrors: [
                                    { message: 'Loader failed.', subtype: 'loader' },
                                    { message: 'Dispose failed.', subtype: 'reporter' }
                                ],
                                summary: { defined: 1, discovered: 1, planned: 1 }
                            });
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, [ 'Overkill runner error: Dispose failed.' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps config errors to exit code 3',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    async loadRunConfig() {
                        throw new RunConfigError('Invalid project policy.');
                    }
                }));

                scope.assert.equal(result.exitCode, 3);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill configuration error: Invalid project policy.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps reporter sink conflicts to exit code 3',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            throw new ReporterSinkConflictError(
                                'Reporter sink conflict: stdout is claimed by incompatible reporters.'
                            );
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 3);
                scope.assert.null(result.runResult);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill configuration error: Reporter sink conflict: stdout is claimed by incompatible reporters.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps aggregate sink conflicts to exit code 3',
            metadata: {},
            async body(scope: OverkillScope) {
                const conflict = new ReporterSinkConflictError(
                    'Reporter sink conflict: stdout is claimed by incompatible reporters.'
                );
                const result = await runTests(createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            throw new AggregateError(
                                [
                                    conflict,
                                    {
                                        attributedTo: null,
                                        cause: new Error('cleanup failed'),
                                        message: 'terminal: cleanup failed',
                                        subtype: 'reporter'
                                    }
                                ],
                                'Execution failed and reporter cleanup failed.',
                                { cause: conflict }
                            );
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 3);
                scope.assert.null(result.runResult);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill configuration error: Reporter sink conflict: stdout is claimed by incompatible reporters.',
                    'Overkill runner error: terminal: cleanup failed'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps request errors to exit code 3',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            throw new RunResolutionError(
                                'Path discovery is not implemented yet.',
                                undefined,
                                'unsupported-request'
                            );
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 3);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: Path discovery is not implemented yet.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() maps internal crashes to exit code 70',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(createRunnerDependencies({
                    orchestrator: {
                        async resolve(command) {
                            return await createRunnerDependencies({}).orchestrator.resolve(command);
                        },
                        async run() {
                            throw new Error('Unexpected failure.');
                        }
                    }
                }));

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: Unexpected failure.'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
