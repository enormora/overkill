import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { Reporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunOrchestrator, RunRequest } from './run-types.ts';

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

const terminalEventReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'terminal-event',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'stdout-raw' } ]
};

const terminalFinishReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'terminal-finish',
    onEvent() {
        return undefined;
    },
    onFinish() {
        return undefined;
    },
    sinks: [ { kind: 'stdout-raw' } ]
};

const terminalFinalResultReporter: Reporter = {
    dispose: null,
    kind: 'final-result',
    name: 'terminal-final-result',
    onResult() {
        return undefined;
    },
    sinks: [ { kind: 'stdout-raw' } ]
};

const defaultRequest: RunRequest = defaultRunRequest();

function defaultLoadedConfig(reporters: LoadedRunConfig['reporters']): LoadedRunConfig {
    return {
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: plainOutputRenderer,
        profiles: {
            microtest: defaultMicrotestProfile()
        },
        reporters,
        runtimeStateDir: '.overkill'
    };
}

function createRunResult(runnerErrors: RunResult['runnerErrors']): RunResult {
    const result = runResultFactory.build({
        summary: { defined: 1, discovered: 1, planned: 1 }
    });

    return {
        ...result,
        runnerErrors
    };
}

function runnerError(
    message: string,
    subtype: RunResult['runnerErrors'][number]['subtype']
): RunResult['runnerErrors'][number] {
    return {
        attributedTo: null,
        cause: null,
        message,
        subtype
    };
}

function createRunnerDependencies(
    reporter: Reporter,
    run: RunOrchestrator['run'],
    deliveredRunnerErrors: readonly RunResult['runnerErrors'][number][]
): CommandLineRunnerDependencies {
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
            return defaultLoadedConfig([ reporter ]);
        },
        orchestrator: {
            async resolve() {
                throw new Error('Resolve is not used by the command-line runner.');
            },
            run,
            async runWithReporterDelivery(command) {
                return {
                    deliveredRunnerErrors,
                    result: await run(command)
                };
            }
        }
    };
}

async function runTests(
    reporter: Reporter,
    run: RunOrchestrator['run'],
    deliveredRunnerErrors: readonly RunResult['runnerErrors'][number][]
): Promise<CommandLineRunnerResult> {
    const runner = createCommandLineRunner(createRunnerDependencies(reporter, run, deliveredRunnerErrors));

    return await runner.runTests({
        configPath: null,
        cwd: process.cwd(),
        runRequest: defaultRequest
    });
}

export const testSuite = createOverkillSuite({
    title: 'source/run/command-line-fallback-diagnostics.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'commandLineRunner.runTests() maps resource exhaustion to exit code 5',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(memoryReporter, async function runCommand() {
                    return runResultFactory.build({
                        runnerErrors: [
                            runnerError('Resource budget exceeded.', 'resource-exhaustion')
                        ],
                        summary: { defined: 1, discovered: 1, planned: 1, resourceExhausted: 1 }
                    });
                }, []);

                scope.assert.equal(result.exitCode, 5);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'commandLineRunner.runTests() maps resource exhaustion before generic runner errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(memoryReporter, async function runCommand() {
                    return runResultFactory.build({
                        runnerErrors: [
                            runnerError('Loader failed.', 'loader'),
                            runnerError('Resource budget exceeded.', 'resource-exhaustion')
                        ],
                        summary: { defined: 1, discovered: 1, planned: 1, resourceExhausted: 1 }
                    });
                }, []);

                scope.assert.equal(result.exitCode, 5);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'commandLineRunner.runTests() omits terminal-delivered runner error fallback diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const deliveredError = runnerError('Loader failed.', 'loader');
                const result = await runTests(terminalEventReporter, async function runCommand() {
                    const runResult = createRunResult([ deliveredError ]);

                    return runResult;
                }, [ deliveredError ]);

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'commandLineRunner.runTests() omits terminal-finished runner error fallback diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const deliveredError = runnerError('Loader failed.', 'loader');
                const result = await runTests(
                    terminalFinishReporter,
                    async function runCommand() {
                        return createRunResult([ deliveredError ]);
                    },
                    [ deliveredError ]
                );

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'commandLineRunner.runTests() omits terminal final-result runner error fallback diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const deliveredError = runnerError('Loader failed.', 'loader');
                const result = await runTests(
                    terminalFinalResultReporter,
                    async function runCommand() {
                        return createRunResult([ deliveredError ]);
                    },
                    [ deliveredError ]
                );

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'commandLineRunner.runTests() falls back to runner errors not delivered to terminal reporters',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await runTests(terminalEventReporter, async function runCommand() {
                    return createRunResult([
                        runnerError('Loader failed.', 'loader'),
                        runnerError('Dispose failed.', 'reporter')
                    ]);
                }, []);

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill runner error: Loader failed.',
                    'Overkill runner error: Dispose failed.'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
