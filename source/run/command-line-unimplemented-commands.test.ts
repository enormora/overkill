import { createFactory } from '@enormora/objectory';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineReporter,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunner
} from './command-line-runner.ts';
import type { CommandLineCommandContext } from './command-line-command.ts';
import {
    createUnimplementedCommand,
    loadUnimplementedBaselineCommands,
    createUnimplementedBaselineCommands
} from './command-line-unimplemented-commands.ts';
import type { RunOrchestrator } from './run-types.ts';

const fixtureCwd = '/project';

const commandLineCommandContextFactory = createFactory<CommandLineCommandContext>(
    function createCommandLineCommandContext() {
        return {
            arguments: [],
            configPath: null,
            cwd: fixtureCwd
        };
    }
);

const singletonRunRequest = defaultRunRequest({
    capabilityRestrictions: { mode: 'disabled' },
    order: 'plan',
    paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ],
    seed: { value: 42n }
});

const memoryReporter = defineReporter(function createMemoryReporter() {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'memory',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    };
});

function createPassingOrchestrator(): RunOrchestrator {
    return {
        async resolve() {
            throw new Error('List resolution is not used.');
        },
        async run() {
            return runResultFactory.build({
                perTest: [ { outcome: { kind: 'pass' } } ],
                summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
            });
        },
        async runWithReporterDelivery() {
            return {
                deliveredRunnerErrors: [],
                result: runResultFactory.build({
                    perTest: [ { outcome: { kind: 'pass' } } ],
                    summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
                }),
                undeliveredRunnerErrors: []
            };
        }
    };
}

function createTestRunner(): CommandLineRunner {
    const config = defaultRunConfig();

    return createCommandLineRunner({
        async createDefaultReporter() {
            return memoryReporter;
        },
        loadBaselineCommands: loadUnimplementedBaselineCommands,
        async loadBenchmarkCommands() {
            const { createBenchmarkCommands } = await import('./benchmark-commands.ts');

            return createBenchmarkCommands(async function loadConfig() {
                return { ...config, configPath: null };
            });
        },
        async loadConfig() {
            return {
                configPath: null,
                loader: config.loader,
                outputRenderer: config.outputRenderer,
                profiles: config.profiles,
                reporters: null,
                runtimeStateDir: config.runtimeStateDir
            };
        },
        orchestrator: createPassingOrchestrator()
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/command-line-unimplemented-commands.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'unimplemented direct commands return argument errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const command = createUnimplementedCommand('replay');
                const result = await command(commandLineCommandContextFactory.build({
                    arguments: [ 'run-1' ]
                }));

                scope.assert.equal(result.exitCode, 3);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: Command "replay" with 1 arguments is not implemented yet.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'unimplemented command families return argument errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const baseline = await loadUnimplementedBaselineCommands();
                const benchmark = createUnimplementedBaselineCommands('bench baseline');
                const context = commandLineCommandContextFactory.build();
                const baselineResult = await baseline.update(context);
                const benchmarkResult = await benchmark.update(context);

                scope.assert.deepEqual(baselineResult.fallbackDiagnostics, [
                    'Overkill argument error: Command "baseline update" is not implemented yet.'
                ]);
                scope.assert.deepEqual(benchmarkResult.fallbackDiagnostics, [
                    'Overkill argument error: Command "bench baseline update" is not implemented yet.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner rejects benchmark selection without configured benchmark profiles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await createTestRunner().bench.listBenchmarks({
                    configPath: null,
                    cwd: fixtureCwd,
                    paths: [],
                    profile: null
                });

                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: No benchmark profiles are configured. Configure a benchmark profile and use --profile.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner singleton runs tests with the default reporter',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await createTestRunner().runTests({
                    configPath: null,
                    cwd: fixtureCwd,
                    runRequest: singletonRunRequest
                });

                scope.assert.equal(result.exitCode, 0);
                scope.assert.deepEqual(result.fallbackDiagnostics, []);
                scope.assert.deepEqual(result.stdoutLines, []);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
