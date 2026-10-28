import { randomBytes } from 'node:crypto';
import { runIfMain } from '#test-runner';
import {
    createRoot,
    createTestPlan,
    type RunnerError,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createDeterministicRunOrchestrator,
    createDeterministicRunOrchestratorWithSeed
} from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';
import { createRuntimeCapabilityPolicy } from './capability-policy.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-runtime-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            title: 'runtime capability checkpoints report mutations before attempt completion',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            async body(scope: OverkillScope) {
                const environment = { VALUE: 'before' };
                const during: RunnerError[] = [];
                const observed = createTestPlan(createRoot({
                    title: 'checkpoint root',
                    annotations: {},
                    controls: {},
                    children: [ createOverkillTestCase({
                        title: 'observed',
                        annotations: {},
                        controls: {},
                        definitionLocations: [ { kind: 'unknown' } ],
                        body() {
                            throw new Error('Policy observation must not execute the case body.');
                        }
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() supports disabled capability restrictions for in-process runs',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() generates in-process seeds outside runtime policy monitoring',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        })
    ]
});

await runIfMain(import.meta, testNode);
