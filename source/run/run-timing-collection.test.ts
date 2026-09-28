import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicOverkillClock } from '../clock/overkill-clock.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { resolveTimingCollection } from './run-facts.ts';
import {
    createRunTimingMeasurement,
    emptyTimingSpanMetadata
} from './run-timing-collection.ts';
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
                    resolveTimingCollection(
                        request,
                        defaultMicrotestProfile({
                            timings: { collection: 'precise' }
                        })
                    ),
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
                    resolveTimingCollection(
                        request,
                        defaultIntegrationProfile({
                            execution: { assignmentPolicy: 'duration-history-balanced' }
                        })
                    ),
                    'precise'
                );
                scope.assert.equal(
                    resolveTimingCollection(
                        request,
                        defaultIntegrationProfile({
                            execution: {
                                hedging: {
                                    durationMultiplier: 2,
                                    minimumDelayMilliseconds: 100,
                                    mode: 'on'
                                },
                                processModel: 'worker-pool'
                            }
                        })
                    ),
                    'precise'
                );
                scope.assert.equal(
                    resolveTimingCollection(
                        request,
                        defaultIntegrationProfile({
                            execution: { dispatchPolicy: 'dynamic-lease' }
                        })
                    ),
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
            title: 'RunTimingMeasurement records parent offsets and local durations',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const clock = createDeterministicOverkillClock();
                const timing = createRunTimingMeasurement(clock);

                clock.advanceByMicroseconds(10);
                timing.measure('collection.resolve', emptyTimingSpanMetadata(), function resolveCollection() {
                    clock.advanceByMicroseconds(25);
                });
                timing.recordLocal({
                    durationMicroseconds: 40,
                    kind: 'worker.import-startup',
                    label: null,
                    processId: 'worker-process',
                    resource: null,
                    startOffsetMicroseconds: 999,
                    status: 'success',
                    workerId: 'lane-1'
                });

                const report = timing.report();
                const parentSpan = report.spans.find(function isParentSpan(span) {
                    return span.kind === 'collection.resolve';
                });
                const localSpan = report.spans.find(function isLocalSpan(span) {
                    return span.kind === 'worker.import-startup';
                });

                if (parentSpan === undefined || localSpan === undefined) {
                    throw new Error('Expected parent and local timing spans.');
                }

                scope.assert.equal(parentSpan.startOffsetMicroseconds, 10);
                scope.assert.equal(parentSpan.durationMicroseconds, 25);
                scope.assert.equal(localSpan.startOffsetMicroseconds, null);
                scope.assert.equal(localSpan.durationMicroseconds, 40);
                scope.assert.equal(
                    report.aggregates.some(function hasWorkerImportAggregate(aggregate) {
                        return aggregate.kind === 'worker.import-startup' && aggregate.durationMicroseconds === 40;
                    }),
                    true
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'RunTimingMeasurement records failed measured work before rethrowing',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const clock = createDeterministicOverkillClock();
                const timing = createRunTimingMeasurement(clock);
                const error = new Error('measurement failure');
                let thrownError: unknown = null;

                try {
                    timing.measure('config.load', emptyTimingSpanMetadata(), function loadConfig() {
                        clock.advanceByMicroseconds(15);
                        throw error;
                    });
                } catch (caughtError: unknown) {
                    thrownError = caughtError;
                }

                scope.assert.equal(thrownError, error);

                scope.assert.deepEqual(timing.report().spans.map(function toStatus(span) {
                    return {
                        durationMicroseconds: span.durationMicroseconds,
                        kind: span.kind,
                        status: span.status
                    };
                }), [
                    {
                        durationMicroseconds: 15,
                        kind: 'config.load',
                        status: 'failure'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() records precise spans for precise collection',
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
                scope.assert.equal(
                    result.timings.precise.spans.some(function isCollectionResolveSpan(span) {
                        return span.kind === 'collection.resolve';
                    }),
                    true
                );
                scope.assert.equal(
                    result.timings.precise.aggregates.some(function isCollectionResolveAggregate(aggregate) {
                        return aggregate.kind === 'collection.resolve';
                    }),
                    true
                );
                scope.assert.equal(result.timings.precise.truncated, false);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
