import { createDeterministicClock } from '@enormora/clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    preciseTimingReport,
    type RunPreciseTimingReport,
    type RunTimingSpan,
    type RunTimingSpanKind
} from '../engine/run-timings.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { resolveTimingCollection } from './run-facts.ts';
import {
    createRunTimingMeasurement,
    emptyTimingSpanMetadata,
    resultWithTimingCollection
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

function timingSpanByKind(report: RunPreciseTimingReport, kind: RunTimingSpanKind): RunTimingSpan {
    const span = report.spans.find(function hasKind(candidate) {
        return candidate.kind === kind;
    });

    if (span === undefined) {
        throw new Error(`Expected ${kind} timing span.`);
    }

    return span;
}

function assertMeasuredParentAndLocalSpans(scope: OverkillScope, report: RunPreciseTimingReport): void {
    const parentSpan = timingSpanByKind(report, 'collection.resolve');
    const localSpan = timingSpanByKind(report, 'worker.import-startup');

    scope.assert.equal(parentSpan.startOffsetMicroseconds, 10);
    scope.assert.equal(parentSpan.startTimeUnixMicroseconds, 10);
    scope.assert.equal(parentSpan.durationMicroseconds, 25);
    scope.assert.equal(localSpan.startOffsetMicroseconds, null);
    scope.assert.equal(localSpan.startTimeUnixMicroseconds, 999);
    scope.assert.equal(localSpan.durationMicroseconds, 40);
    scope.assert.equal(
        report.aggregates.some(function hasWorkerImportAggregate(aggregate) {
            return aggregate.kind === 'worker.import-startup' && aggregate.durationMicroseconds === 40;
        }),
        true
    );
}

function inProcessConfig(profile = defaultMicrotestProfile()): RunConfig {
    return defaultRunConfig({
        profiles: {
            microtest: {
                ...profile,
                execution: {
                    maxConcurrency: profile.execution.maxConcurrency,
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
                const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
                const timing = createRunTimingMeasurement(clock);

                clock.advanceByMicroseconds(10n);
                timing.measure('collection.resolve', emptyTimingSpanMetadata(), function resolveCollection() {
                    clock.advanceByMicroseconds(25n);
                });
                timing.recordLocal({
                    durationMicroseconds: 40,
                    kind: 'worker.import-startup',
                    label: null,
                    processId: 'worker-process',
                    resource: null,
                    startOffsetMicroseconds: 999,
                    startTimeUnixMicroseconds: 999,
                    status: 'success',
                    workerId: 'lane-1'
                });

                const report = timing.report();
                assertMeasuredParentAndLocalSpans(scope, report);
                scope.assert.deepEqual(report.observationWindow, {
                    durationMicroseconds: 35,
                    startTimeUnixMicroseconds: 0
                });
                scope.assert.equal(Number(clock.monotonicTimeOriginUnixEpochMicroseconds), 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'RunTimingMeasurement records failed measured work before rethrowing',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
                const timing = createRunTimingMeasurement(clock);
                const error = new Error('measurement failure');
                let thrownError: unknown = null;

                try {
                    timing.measure('config.load', emptyTimingSpanMetadata(), function loadConfig() {
                        clock.advanceByMicroseconds(15n);
                        throw error;
                    });
                } catch (caughtError: unknown) {
                    thrownError = caughtError;
                }

                scope.assert.equal(thrownError, error);

                scope.assert.deepEqual(
                    timing.report().spans.map(function toStatus(span) {
                        return {
                            durationMicroseconds: span.durationMicroseconds,
                            kind: span.kind,
                            status: span.status
                        };
                    }),
                    [
                        {
                            durationMicroseconds: 15,
                            kind: 'config.load',
                            status: 'failure'
                        }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resultWithTimingCollection() preserves summary mode and existing precise reports',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const summaryResult = runResultFactory.build();
                const preciseReport = preciseTimingReport({
                    aggregationMicroseconds: 0,
                    observationWindow: { durationMicroseconds: 0, startTimeUnixMicroseconds: 0 },
                    recordingMicroseconds: 0,
                    slowestSpanLimit: 50,
                    spanLimit: 5000,
                    spans: []
                });
                const preciseResult = runResultFactory.build({
                    timings: {
                        precise: preciseReport,
                        summary: summaryResult.timings.summary
                    }
                });

                scope.assert.equal(resultWithTimingCollection('summary', summaryResult), summaryResult);
                scope.assert.equal(resultWithTimingCollection('precise', preciseResult), preciseResult);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resultWithTimingCollection() creates fallback precise reports',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const result = resultWithTimingCollection('precise', runResultFactory.build());

                scope.require.notNull(result.timings.precise);
                scope.assert.deepEqual(result.timings.precise.spans, []);
                scope.assert.equal(result.timings.summary.totalWallTimeMicroseconds, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resultWithTimingCollection() derives collection-error summary from observed spans',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
                const timing = createRunTimingMeasurement(clock);

                clock.advanceByMicroseconds(20n);
                timing.measure('collection.resolve', emptyTimingSpanMetadata(), function resolveCollection() {
                    clock.advanceByMicroseconds(30n);
                });

                const result = resultWithTimingCollection('precise', runResultFactory.build(), timing);

                scope.assert.equal(result.timings.summary.totalWallTimeMicroseconds, 50);
                scope.assert.equal(result.timings.summary.runnerOverheadWallTimeMicroseconds, 50);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'resultWithTimingCollection() derives summary from local precise spans',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const timing = createRunTimingMeasurement(
                    createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
                );

                timing.recordLocal({
                    durationMicroseconds: 70,
                    kind: 'worker.import-startup',
                    label: null,
                    processId: 'worker-process',
                    resource: null,
                    startOffsetMicroseconds: 999,
                    startTimeUnixMicroseconds: 999,
                    status: 'success',
                    workerId: 'lane-1'
                });

                const result = resultWithTimingCollection('precise', runResultFactory.build(), timing);

                scope.assert.equal(result.timings.summary.totalWallTimeMicroseconds, 70);

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
