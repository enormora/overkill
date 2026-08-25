import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
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

export const testSuite = createOverkillSuite({
    name: 'source/run/run-profile-discriminator.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects profiles without a test family',
            metadata: {},
            async body(scope: OverkillScope) {
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
                    message: 'Invalid run profile "microtest": testFamily must be "microtest".'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects unsupported profile test families',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveInvalidProfile() {
                    await orchestrator.resolve(createRunCommand(
                        defaultRunConfig({
                            profiles: {
                                backend: {
                                    ...defaultMicrotestProfile(),
                                    testFamily: 'integration'
                                } as unknown as RunConfig['profiles'][string]
                            }
                        }),
                        'backend'
                    ));
                }, {
                    message: 'Invalid run profile "backend": testFamily must be "microtest".'
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
