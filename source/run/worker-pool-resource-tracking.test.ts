import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunnerError,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createCollectedPlan,
    fakeReporterDelivery,
    fakeWorkerRuntime
} from './worker-pool-execution-state.test.ts';
import {
    reportRunStart,
    startPoolResourceTracking
} from './worker-pool-resource-tracking.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;
const reporterDeliveryError: RunnerError = {
    attributedTo: null,
    attributedToWork: null,
    cause: null,
    diagnostics: [],
    message: 'Reporter delivery failed.',
    subtype: 'reporter'
};

function runtimeWithEmptyPlacementPlan(): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool resource-tracking fixture requires worker-pool facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...execution,
                    placementPlan: { assignments: [], lanes: [], units: [] }
                }
            }
        }
    };
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-resource-tracking.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution skips run start for empty placement plans',
            async body(scope: OverkillScope) {
                let reportedEvents = 0;
                const runtime = {
                    ...runtimeWithEmptyPlacementPlan(),
                    reporterDelivery: {
                        ...fakeReporterDelivery,
                        async reportEvent() {
                            reportedEvents += 1;

                            return [];
                        }
                    }
                };

                await reportRunStart(runtime, 0);
                scope.assert.equal(reportedEvents, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution records run-start reporter delivery errors',
            async body(scope: OverkillScope) {
                const runtime = {
                    ...fakeWorkerRuntime(createCollectedPlan()),
                    reporterDelivery: {
                        ...fakeReporterDelivery,
                        async reportEvent() {
                            return [ reporterDeliveryError ];
                        }
                    }
                };

                await reportRunStart(runtime, 0);
                scope.assert.deepEqual(runtime.runState.runnerErrors(), [ reporterDeliveryError ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution starts pool resource tracking with optional start waiters',
            async body(scope: OverkillScope) {
                let startCount = 0;
                let waited = false;
                const tracker = {
                    finish() {
                        throw new Error('Pool resource tracker finish is not used by this test.');
                    },
                    start() {
                        startCount += 1;
                    }
                };

                await startPoolResourceTracking({
                    ...fakeWorkerRuntime(createCollectedPlan()),
                    poolResourceUsageTracker: tracker
                });
                await startPoolResourceTracking({
                    ...fakeWorkerRuntime(createCollectedPlan()),
                    poolResourceUsageTracker: {
                        ...tracker,
                        async waitForStart() {
                            waited = true;
                        }
                    }
                });
                scope.assert.equal(startCount, 2);
                scope.assert.equal(waited, true);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
