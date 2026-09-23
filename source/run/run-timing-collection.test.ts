import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { resolveTimingCollection } from './run-facts.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

function runCommand(config: RunConfig, request: RunRequest): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request
    };
}

function inProcessConfig(profile = defaultMicrotestProfile()): RunConfig {
    return defaultRunConfig({
        profiles: {
            microtest: {
                ...profile,
                execution: {
                    processModel: 'in-process',
                    scheduling: profile.execution.scheduling
                }
            }
        }
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-timing-collection.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resolveTimingCollection() applies profile and request policy',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const request = defaultRunRequest();

                scope.assert.equal(resolveTimingCollection(request, defaultMicrotestProfile()), 'summary');
                scope.assert.equal(
                    resolveTimingCollection(request, defaultMicrotestProfile({
                        timings: { collection: 'precise' }
                    })),
                    'precise'
                );
                scope.assert.equal(
                    resolveTimingCollection({
                        ...request,
                        timingCollection: 'precise'
                    }, defaultMicrotestProfile()),
                    'precise'
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resolveTimingCollection() upgrades strategies that consume timing facts',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const request = defaultRunRequest();

                scope.assert.equal(
                    resolveTimingCollection(request, defaultIntegrationProfile({
                        execution: { assignmentPolicy: 'duration-history-balanced' }
                    })),
                    'precise'
                );
                scope.assert.equal(
                    resolveTimingCollection(request, defaultIntegrationProfile({
                        execution: {
                            hedging: {
                                durationMultiplier: 2,
                                minimumDelayMilliseconds: 100,
                                mode: 'on'
                            },
                            processModel: 'worker-pool'
                        }
                    })),
                    'precise'
                );
                scope.assert.equal(
                    resolveTimingCollection(request, defaultIntegrationProfile({
                        execution: { dispatchPolicy: 'dynamic-lease' }
                    })),
                    'summary'
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() leaves precise timings absent by default',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const orchestrator = createDeterministicRunOrchestrator();
                const result = await orchestrator.run(runCommand(
                    inProcessConfig(),
                    defaultRunRequest({ paths: [ passingFixturePath ] })
                ));

                scope.assert.equal(result.timings.precise, null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() attaches an empty precise report for precise collection',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const orchestrator = createDeterministicRunOrchestrator();
                const result = await orchestrator.run(runCommand(
                    inProcessConfig(),
                    defaultRunRequest({
                        paths: [ passingFixturePath ],
                        timingCollection: 'precise'
                    })
                ));

                scope.require.notNull(result.timings.precise);
                scope.assert.deepEqual(result.timings.precise.spans, []);
                scope.assert.deepEqual(result.timings.precise.aggregates, []);
                scope.assert.equal(result.timings.precise.truncated, false);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
