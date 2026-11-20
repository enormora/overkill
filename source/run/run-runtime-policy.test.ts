import { randomBytes } from 'node:crypto';
import { type TestNode, suite, test } from '@overkill-dev/test';

import { type RunnerError, createRoot, createTestPlan } from '../packages/engine/engine.entry-point.ts';

import {
    createDeterministicRunOrchestrator,
    createDeterministicRunOrchestratorWithSeed
} from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';
import { createRuntimeCapabilityPolicy } from './capability-policy.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/integration/fixtures/passing.test.ts';
const defaultConfig: NormalizedConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: { processModel: 'in-process' }
        })
    }
});
const defaultRequest: RunRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export const testNode: TestNode = suite('Run runtime policy', [
    test(
        'runtime capability checkpoints report mutations before attempt completion',
        async function (scope) {
            const environment = { VALUE: 'before' };
            const during: RunnerError[] = [];
            const observed = createTestPlan(createRoot({
                title: 'checkpoint root',
                annotations: {},
                controls: {},
                children: [ test('observed', function () {
                    throw new Error('Policy observation must not execute the case body.');
                }) ]
            }))
                .cases[0];
            const policy = createRuntimeCapabilityPolicy({
                dependencies: {
                    observeIpcListeners() {
                        return function () {
                            return undefined;
                        };
                    },
                    observeProcessExit() {
                        return function () {
                            return undefined;
                        };
                    },
                    readEnvironment() {
                        return environment;
                    },
                    readStorage() {
                        return null;
                    }
                },
                observedStderr: false,
                observedStdout: false
            });
            await policy.runAttempt(observed, { index: 0 }, async function mutateBeforeCheckpoint() {
                environment.VALUE = 'after';
                during.push(...policy.takeAttemptErrors(observed, { index: 0 }));
            });
            const after = policy.takeAttemptErrors(observed, { index: 0 });
            policy.takeRunErrors();
            scope.assert.deepEqual(
                during.map(function violation(error) {
                    return error.message;
                }),
                [ 'Runtime policy violation: process.env changed.' ]
            );
            scope.assert.deepEqual(after, []);
            return scope.assert.collect();
        }
    ),
    test(
        'orchestrator.run() supports disabled capability restrictions for in-process runs',
        async function (scope) {
            const runOrchestrator = createDeterministicRunOrchestrator();
            const result = await runOrchestrator.run(createRunCommand({
                config: defaultConfig,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: {
                    ...defaultRequest,
                    capabilityRestrictions: { mode: 'disabled' }
                }
            }));

            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.summary.passed, 1);

            return scope.assert.collect();
        }
    ),
    test(
        'orchestrator.run() generates in-process seeds outside runtime policy monitoring',
        async function (scope) {
            const runOrchestrator = createDeterministicRunOrchestratorWithSeed(function createRandomSeed() {
                return randomBytes(8).readBigUInt64BE();
            });
            const result = await runOrchestrator.run(createRunCommand({
                config: defaultConfig,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: {
                    ...defaultRequest,
                    seed: { value: null }
                }
            }));

            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.summary.passed, 1);

            return scope.assert.collect();
        }
    )
]);
