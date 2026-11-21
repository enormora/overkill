import { suite, test } from '@overkill-dev/test';

import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultIntegrationProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';

const passingFixturePath = 'source/integration-tests/runtime/fixtures/passing.test.ts';

export const testNode = suite('Run coverage request', [
    test('orchestrator.resolve() rejects integration coverage before discovery', async function (scope) {
        const runOrchestrator = createUnitRunOrchestrator();

        await scope.assert.rejects(async function resolveIntegrationCoverage() {
            await runOrchestrator.resolve({
                config: defaultRunConfig({
                    profiles: {
                        integration: defaultIntegrationProfile({})
                    }
                }),
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: defaultRunRequest({
                    coverage: true,
                    paths: [ 'source/does-not-exist.test.ts' ],
                    profile: 'integration'
                })
            });
        }, { message: 'Coverage can only be requested for microtest profiles.' });

        return scope.assert.collect();
    }),
    test('orchestrator.resolve() records requested microtest coverage', async function (scope) {
        const runOrchestrator = createUnitRunOrchestrator();
        const resolvedRun = await runOrchestrator.resolve({
            config: defaultRunConfig(),
            cwd: process.cwd(),
            engine: { kind: 'default' },
            request: defaultRunRequest({
                coverage: true,
                paths: [ passingFixturePath ]
            })
        });

        scope.assert.equal(resolvedRun.facts.execution.coverage, true);

        return scope.assert.collect();
    })
]);
