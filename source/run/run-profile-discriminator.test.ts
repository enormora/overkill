import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import type { RunCommand, RunConfig } from './run-types.ts';

function createRunCommand(config: RunConfig, profileName: string): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ],
            profile: profileName
        })
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-profile-discriminator.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects profiles without a test family',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const orchestrator = createDeterministicRunOrchestrator();
                const profile: Record<string, unknown> = { ...defaultMicrotestProfile() };

                delete profile.testFamily;

                await scope.assert.rejects(async function resolveInvalidProfile() {
                    await orchestrator.resolve(createRunCommand(
                        defaultRunConfig({
                            profiles: {
                                microtest: profile as unknown as RunConfig['profiles'][string]
                            }
                        }),
                        'microtest'
                    ));
                }, {
                    message: 'Invalid run profile "microtest": testFamily must be "integration" or "microtest".'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects unsupported profile test families',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const orchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveInvalidProfile() {
                    await orchestrator.resolve(createRunCommand(
                        defaultRunConfig({
                            profiles: {
                                backend: {
                                    ...defaultMicrotestProfile(),
                                    testFamily: 'property'
                                } as unknown as RunConfig['profiles'][string]
                            }
                        }),
                        'backend'
                    ));
                }, {
                    message: 'Invalid run profile "backend": testFamily must be "integration" or "microtest".'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
