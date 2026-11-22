import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';
import type { ConfiguredRunCommand, RunCommand } from '../packages/run/run.entry-point.ts';
import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import {
    defaultRequest,
    createRecordedRunCommands,
    createRunnerDependencies
} from '../test-support/process-usage-runner-fixture.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { createCommandLineRunner } from './command-line-runner.ts';

const assertProcessUsageCommand = defineCompositeAssertion({
    name: 'process usage command',
    assert(check, suppliedCommand: ConfiguredRunCommand | RunCommand) {
        const { command } = snapshotRunCommand(suppliedCommand);
        const profile = command.config.profiles.microtest;
        if (profile === undefined) {
            return check.defined(profile);
        }
        const initialChecks = check.group([
            check.defined(profile),
            check.deepEqual(profile, {
                failureArtifacts: defaultFailureArtifactPolicy,
                baselines: { adapters: [], directory: 'test-baselines', snapshots: false, stale: 'fail' },
                coverage: {
                    outputDirectory: null,
                    outputs: [ 'v8', 'lcov' ],
                    sources: { exclude: [], mode: 'loaded' },
                    thresholds: { branches: null, functions: null, lines: null }
                },
                execution: {
                    maxConcurrency: 5,
                    processModel: 'supervised-process',
                    scheduling: 'concurrent'
                },
                files: null,
                reporters: null,
                processUsage: {
                    budgets: {
                        activeResourceCount: 2,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: 200,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: true,
                    samplingIntervalMilliseconds: 25
                },
                testFamily: 'microtest',
                runRecords: { persist: 'on-demand' },
                timings: { collection: 'summary' },
                timeouts: {
                    collectionMilliseconds: 1000,
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                }
            })
        ]);
        const { processBudgetOverrides } = command.request;
        if (processBudgetOverrides === null) {
            return check.group([ initialChecks, check.notNull(processBudgetOverrides) ]);
        }
        return check.group([
            initialChecks,
            check.notNull(processBudgetOverrides),
            check.deepEqual(processBudgetOverrides, {
                activeResourceCount: null,
                javaScriptEngineHeapBytes: 100,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            })
        ]);
    }
});

export const testNode = suite('Command line runner process usage', [
    test(
        'commandLineRunner.runTests() carries process usage config and request values',
        async function (scope: TestScope) {
            const recordedCommands = createRecordedRunCommands();
            const runner = createCommandLineRunner(createRunnerDependencies(recordedCommands));
            const result = await runner.runTests({
                configPath: null,
                cwd: process.cwd(),
                runRequest: {
                    ...defaultRequest,
                    processBudgetOverrides: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: 100,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    }
                }
            });

            scope.assert.equal(result.exitCode, 0);
            const receivedCommand = recordedCommands.first();
            scope.require.defined(receivedCommand);
            scope.assert(assertProcessUsageCommand, receivedCommand);

            return scope.assert.collect();
        }
    )
]);
