import { createFactory } from '@enormora/objectory';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { commandLineRunner } from './command-line-runner.ts';
import type { CommandLineCommandContext } from './command-line-command.ts';
import {
    createUnimplementedCommand,
    loadUnimplementedBaselineCommands,
    loadUnimplementedBenchmarkCommands
} from './command-line-unimplemented-commands.ts';
import type { RunRequest } from './run-types.ts';

const commandLineCommandContextFactory = createFactory<CommandLineCommandContext>(
    function createCommandLineCommandContext() {
        return {
            arguments: [],
            configPath: null,
            cwd: process.cwd()
        };
    }
);

const singletonRunRequest: RunRequest = {
    baselineUpdateMode: 'none',
    capabilityRestrictions: { mode: 'disabled' },
    capture: 'buffered',
    debug: {
        mode: 'off',
        selectors: []
    },
    execution: { mode: 'profile-default' },
    measureResourceUsage: null,
    order: 'plan',
    paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ],
    profile: 'microtest',
    resourceBudgetOverrides: null,
    resourceUsageSamplingIntervalMilliseconds: null,
    seed: { value: 42n },
    selection: { kind: 'all' },
    shard: { index: 0, total: 1 },
    verbose: false
};

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-unimplemented-commands.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'unimplemented direct commands return argument errors',
            metadata: {},
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
            name: 'unimplemented command families return argument errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const baseline = await loadUnimplementedBaselineCommands();
                const benchmark = await loadUnimplementedBenchmarkCommands();
                const context = commandLineCommandContextFactory.build();
                const baselineResult = await baseline.update(context);
                const benchmarkResult = await benchmark.runBenchmarks(context);

                scope.assert.deepEqual(baselineResult.fallbackDiagnostics, [
                    'Overkill argument error: Command "baseline update" is not implemented yet.'
                ]);
                scope.assert.deepEqual(benchmarkResult.fallbackDiagnostics, [
                    'Overkill argument error: Command "bench run" is not implemented yet.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner singleton uses unimplemented command families',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await commandLineRunner.bench.listBenchmarks(commandLineCommandContextFactory.build());

                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: Command "bench list" is not implemented yet.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner singleton runs tests with the default reporter',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await commandLineRunner.runTests({
                    configPath: null,
                    cwd: process.cwd(),
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
