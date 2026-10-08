import { createSuite, createTestCase } from '../../packages/engine/engine.entry-point.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../test-support/run-command-factory.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const fixturePath = 'source/integration-tests/run/fixtures/large-ipc-results.test.ts';
const caseCount = 32;

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/run/runner-ipc-results.test.ts',
    children: [ false, true ].map(function coverageScenario(coverage) {
        return createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: `supervised runs preserve large IPC plans and results with coverage ${coverage}`,
            async body(scope) {
                const result = await orchestrator.run({
                    config: defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                coverage: {
                                    outputs: [ 'json' ],
                                    sources: {
                                        exclude: [],
                                        include: [ 'source/integration-tests/run/fixtures/coverage-source.ts' ],
                                        mode: 'all'
                                    }
                                },
                                execution: {
                                    maxConcurrency: 1,
                                    processModel: 'supervised-process',
                                    scheduling: 'serial'
                                },
                                timeouts: {
                                    collectionMilliseconds: 30_000,
                                    hardMilliseconds: 30_000,
                                    softMilliseconds: 20_000
                                }
                            })
                        },
                        runtimeStateDir: 'target/ipc-results-integration'
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest({ coverage, paths: [ fixturePath ] })
                });

                scope.assert.equal(result.status, 'passed', { message: JSON.stringify(result.runnerErrors) });
                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.deepEqual({
                    discovered: result.summary.discovered,
                    planned: result.summary.planned,
                    passed: result.summary.passed
                }, { discovered: caseCount, planned: caseCount, passed: caseCount });
                scope.assert.equal(result.perTest.length, caseCount);
                const identities = new Set(result.perTest.map(function identity(test) {
                    return JSON.stringify(test.workId);
                }));
                scope.assert.equal(identities.size, caseCount);
                scope.assert.equal(
                    result.artifacts.some(function isCoverage(artifact) {
                        return artifact.payload.kind === 'coverage';
                    }),
                    coverage
                );
                return scope.assert.collect();
            }
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
