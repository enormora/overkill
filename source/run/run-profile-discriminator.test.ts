import { type TestNode, suite, test } from '@overkill-dev/test';

import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import type { NormalizedConfig } from '../config/types.ts';
import type { RunCommand } from './run-types.ts';

function createRunCommand(config: NormalizedConfig, profileName: string): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            paths: [ 'source/integration-tests/integration/fixtures/passing.test.ts' ],
            profile: profileName
        })
    };
}

const requiredFamilyMessage = 'testFamily must be one of benchmark, integration, microtest, property.';

export const testNode: TestNode = suite('Run profile discriminator', [
    test('orchestrator.resolve() rejects profiles without a test family', async function (scope) {
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
    }),
    test('orchestrator.resolve() rejects unsupported profile test families', async function (scope) {
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
    })
]);
