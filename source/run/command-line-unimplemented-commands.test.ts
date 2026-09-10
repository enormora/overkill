import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFactory } from '@enormora/objectory';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
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

async function writeSingletonRunConfig(): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-command-line-runner-'));
    const configPath = path.join(directory, 'overkill.config.js');

    await fs.writeFile(
        configPath,
        `export const config = {
    profiles: {
        microtest: {
            testFamily: 'microtest',
            timeouts: { collectionMilliseconds: 5000 }
        }
    }
};
`,
        'utf8'
    );

    return configPath;
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner singleton uses unimplemented command families',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await commandLineRunner.bench.listBenchmarks(commandLineCommandContextFactory.build());

                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: Command "bench list" is not implemented yet.'
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
                const result = await commandLineRunner.runTests({
                    configPath: await writeSingletonRunConfig(),
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
