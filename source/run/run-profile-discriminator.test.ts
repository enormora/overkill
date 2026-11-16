import { runIfMain } from '#test-runner';
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
import type { NormalizedConfig } from '../config/types.ts';
import type { RunCommand } from './run-types.ts';

function createRunCommand(config: NormalizedConfig, profileName: string): RunCommand {
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

const requiredFamilyMessage = 'testFamily must be one of benchmark, integration, microtest, property.';

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
                                microtest: profile as unknown as NormalizedConfig['profiles'][string]
                            }
                        }),
                        'microtest'
                    ));
                }, {
                    message: `Invalid profile "microtest": ${requiredFamilyMessage}`
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
                                    testFamily: 'unknown-family'
                                } as unknown as NormalizedConfig['profiles'][string]
                            }
                        }),
                        'backend'
                    ));
                }, {
                    message: `Invalid profile "backend": ${requiredFamilyMessage}`
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
