import { suite, test } from '@overkill-dev/test';

import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';

import type { RunCommand, RunRequest } from './run-types.ts';
import { validateRunInput } from './run-validation.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/runtime/fixtures/passing.test.ts';
const defaultConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const defaultRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export const testNode = suite('Run validation', [
    test('programmatic calls can omit debug activation', async function (scope) {
        const orchestrator = createUnitRunOrchestrator();
        const { debug: _debug, ...request } = defaultRequest;
        const command = {
            config: defaultConfig,
            cwd: process.cwd(),
            engine: { kind: 'default' as const },
            request
        };
        const result = await orchestrator.run(command);
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(result.artifacts, []);
        return scope.assert.collect();
    }),
    test('programmatic debug requests validate their shape and selectors', function (scope) {
        const command = { config: defaultConfig, cwd: process.cwd(), engine: { kind: 'default' as const } };
        const empty = { mode: 'selected', selectors: [] } as unknown as RunRequest['debug'];
        scope.assert.throws(function validateEmptySelection() {
            validateRunInput({ ...command, request: { ...defaultRequest, debug: empty } });
        }, { name: 'RunResolutionError' });
        scope.assert.throws(function validateMalformedSelector() {
            validateRunInput({
                ...command,
                request: { ...defaultRequest, debug: { mode: 'selected', selectors: [ '' ] } }
            });
        }, { message: 'Run filter expression must not be empty.' });
        return scope.assert.collect();
    }),
    test('orchestrator.resolve() rejects invalid sharding', async function (scope) {
        const runOrchestrator = createUnitRunOrchestrator();
        const invalidShardCases = [
            { message: 'Shard total must be a positive safe integer.', shard: { index: 1, total: 0 } },
            { message: 'Shard total must be a positive safe integer.', shard: { index: 1, total: 1.5 } },
            { message: 'Shard index must be a positive safe integer.', shard: { index: 0, total: 2 } },
            { message: 'Shard index must be a positive safe integer.', shard: { index: 1.5, total: 2 } },
            { message: 'Shard index must not exceed shard total.', shard: { index: 3, total: 2 } }
        ] as const;

        for (const invalidShardCase of invalidShardCases) {
            await scope.assert.rejects(async function resolveInvalidShard() {
                await runOrchestrator.resolve(createRunCommand({
                    config: defaultConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: { ...defaultRequest, shard: invalidShardCase.shard }
                }));
            }, { message: invalidShardCase.message });
        }

        return scope.assert.collect();
    }),
    test('orchestrator.run() rejects invalid requests before collection', async function (scope) {
        const runOrchestrator = createUnitRunOrchestrator();

        await scope.assert.rejects(async function runInvalidRequest() {
            await runOrchestrator.run(createRunCommand({
                config: defaultConfig,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: { ...defaultRequest, seed: { value: -1n } }
            }));
        }, { message: 'Run seed must be a nonnegative bigint.' });
        await scope.assert.rejects(async function runInvalidSelectionRequest() {
            await runOrchestrator.run(createRunCommand({
                config: defaultConfig,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: {
                    ...defaultRequest,
                    selection: { kind: 'missing' } as unknown as RunRequest['selection']
                }
            }));
        }, { message: 'Run selection kind is unknown.' });

        return scope.assert.collect();
    })
]);
