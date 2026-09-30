import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-coverage-request.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects integration coverage before discovery',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() records requested microtest coverage',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
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
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
