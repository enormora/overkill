import { suite, test } from '@overkill-dev/test';

import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    isolatedRunStateDirectory,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';
import { executeEmptyShardRun } from './run-empty-shard.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand, RunRequest } from './run-types.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/runtime/fixtures/passing.test.ts';

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function inProcessMicrotestConfig(): NormalizedConfig {
    return defaultRunConfig({
        runtimeStateDir: isolatedRunStateDirectory(),
        profiles: {
            microtest: defaultMicrotestProfile({
                execution: { processModel: 'in-process' }
            })
        }
    });
}

async function emptyShardResult(
    runOrchestrator: RunOrchestrator,
    capabilityRestrictions: RunRequest['capabilityRestrictions']
): Promise<Awaited<ReturnType<RunOrchestrator['run']>>> {
    const results = await Promise.all([ 1, 2 ].map(async function runShard(index) {
        return await runOrchestrator.run(createRunCommand({
            config: inProcessMicrotestConfig(),
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({
                capabilityRestrictions,
                paths: [ passingFixturePath ],
                shard: { index, total: 2 }
            })
        }));
    }));
    const emptyShard = results.find(function isEmptyShard(result) {
        return result.planStatus === 'empty-shard';
    });

    if (emptyShard === undefined) {
        throw new Error('Expected one empty shard.');
    }

    return emptyShard;
}

export const testNode = suite('Run empty shard', [
    test('orchestrator.run() reports in-process empty shards as passing', async function (scope) {
        const runOrchestrator = createDeterministicRunOrchestrator();
        const emptyShard = await emptyShardResult(runOrchestrator, { mode: 'enabled' });
        const resolvedRun = await runOrchestrator.resolve(createRunCommand({
            config: inProcessMicrotestConfig(),
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({ paths: [ passingFixturePath ] })
        }));

        scope.assert.equal(emptyShard.status, 'passed');
        scope.assert.equal(emptyShard.summary.planned, 0);
        scope.assert.deepEqual(emptyShard.runnerErrors, []);
        await scope.assert.rejects(async function executeNonEmptyShardPlan() {
            await executeEmptyShardRun(
                resolvedRun,
                {} as unknown as RunOrchestratorDependencies,
                async function keepResult(_run, result) {
                    return result;
                },
                null
            );
        }, { message: 'Empty shard execution requires an empty-shard collected plan.' });

        return scope.assert.collect();
    }),
    test('orchestrator.run() reports empty shards without a runtime policy', async function (scope) {
        const emptyShard = await emptyShardResult(
            createDeterministicRunOrchestrator(),
            { mode: 'disabled' }
        );

        scope.assert.equal(emptyShard.status, 'passed');
        scope.assert.equal(emptyShard.summary.planned, 0);
        scope.assert.deepEqual(emptyShard.runnerErrors, []);

        return scope.assert.collect();
    })
]);
