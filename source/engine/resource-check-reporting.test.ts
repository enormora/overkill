import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import {
    type TestPlan,
    type ReporterEvent,
    type RunResult,
    createRoot,
    createTestCase,
    createTestPlan
} from '../packages/engine/engine.entry-point.ts';

import {
    currentResourceCheckDelivery,
    withResourceCheckDelivery,
    type ResourceCheckDelivery
} from '../resource-check-delivery.ts';
import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import { withResourceCheckReporting } from './resource-check-reporting.ts';

type ReportingScenario = {
    readonly plan: TestPlan;
    readonly events: readonly ReporterEvent[];
    readonly delivery: StoredValue<ResourceCheckDelivery | null>;
    readonly reporter: Pick<ReporterDelivery, 'reportEvent'>;
};
function reportingScenario(): ReportingScenario {
    const metadata = {
        title: 'consumer',
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ]
    } as const;
    const node = createTestCase({
        ...metadata,
        body(scope) {
            scope.assert.true(true);
            return scope.assert.collect();
        }
    });
    const plan = createTestPlan(createRoot({ ...metadata, children: [ node ] }));
    const events: ReporterEvent[] = [];
    return {
        plan,
        events,
        delivery: createStoredValue<ResourceCheckDelivery | null>(null),
        reporter: {
            async reportEvent(event: ReporterEvent) {
                events.push(event);
                return [];
            }
        }
    };
}
function activeDelivery(): ResourceCheckDelivery {
    const delivery = currentResourceCheckDelivery();
    if (delivery === null) {
        throw new Error('Expected an active reporting delivery.');
    }
    return delivery;
}
function observedSnapshot(delivery: ResourceCheckDelivery): ResourceCheckSnapshot {
    return {
        owner: { run: delivery.run, id: 'owner', scope: 'per-run' },
        resource: 'service',
        revision: 1,
        interval: { kind: 'lifetime' },
        passing: 1,
        errors: [],
        failures: [],
        status: { kind: 'complete' }
    };
}
async function finishOwnedObservation(scenario: ReportingScenario): Promise<RunResult> {
    return await withResourceCheckReporting(scenario.reporter, null, scenario.plan, async function observeOwner() {
        const delivery = activeDelivery();
        const snapshot = observedSnapshot(delivery);
        scenario.delivery.write(delivery);
        delivery.register(
            snapshot.owner,
            snapshot.resource,
            scenario.plan.cases.map(function work(testCase) {
                return testCase.workId;
            }),
            async function finalize() {
                return undefined;
            }
        );
        delivery.checkpoint(snapshot);
        return runResultFactory.build({ status: 'passed' });
    });
}
function recordingTransport(record: (event: string) => void): ResourceCheckDelivery {
    return {
        kind: 'transport',
        run: 'upstream',
        register() {
            record('register');
        },
        checkpoint(snapshot) {
            record(`checkpoint:${snapshot.revision}`);
        },
        stop() {
            record('stop');
        },
        active() {
            record('active');
            return function release() {
                record('release');
            };
        },
        async flush() {
            return undefined;
        }
    };
}
async function stoppedObservation(scenario: ReportingScenario): Promise<RunResult> {
    return await withResourceCheckReporting(scenario.reporter, null, scenario.plan, async function stopOwner() {
        const delivery = activeDelivery();
        const snapshot: ResourceCheckSnapshot = {
            ...observedSnapshot(delivery),
            errors: [ { interval: { kind: 'lifetime' }, target: 'service', cause: 'observation stopped' } ],
            status: { kind: 'incomplete', reasons: [ 'stop requested' ] }
        };
        delivery.register(
            snapshot.owner,
            snapshot.resource,
            scenario.plan.cases.map(function work(testCase) {
                return testCase.workId;
            }),
            async function finalize() {
                return undefined;
            }
        );
        delivery.checkpoint(snapshot);
        const release = delivery.active(
            { kind: 'attempt', work: scenario.plan.cases[0].workId, attempt: { index: 0 } },
            function cancelled() {
                return undefined;
            }
        );
        delivery.stop(snapshot.owner, snapshot.interval, 'observation stopped');
        release();
        return runResultFactory.build({ status: 'passed' });
    });
}
export const testNode = authoredSuite('resource check reporting ownership', [
    test('forwards owner evidence and cancellation through the active transport', async function (scope) {
        const scenario = reportingScenario();
        const events: string[] = [];
        const result = await withResourceCheckDelivery(
            recordingTransport(function transportEvent(event) {
                events.push(event);
            }),
            async function reportStoppedOwner() {
                return await stoppedObservation(scenario);
            }
        );
        scope.assert.deepEqual(events, [ 'register', 'checkpoint:0', 'checkpoint:1', 'active', 'stop', 'release' ]);
        scope.assert.equal(result.resourceChecks[0]?.owner.run, 'upstream');
        scope.assert.equal(result.status, 'failed');
        return scope.assert.collect();
    }),
    test('does not deliver late checkpoints after reporter finalization', async function (scope: TestScope) {
        const scenario = reportingScenario();
        const result = await finishOwnedObservation(scenario);
        const delivery = scenario.delivery.read();
        scope.require.defined(delivery);
        delivery.checkpoint({ ...observedSnapshot(delivery), revision: 2, passing: 2 });
        scope.assert.equal(scenario.events.length, 2);
        scope.assert.equal(result.resourceChecks[0]?.passing, 1);
        return scope.assert.collect();
    }),
    test('ignores findings and stop requests from owners outside the selected plan', async function (scope) {
        const scenario = reportingScenario();
        const result = await withResourceCheckReporting(
            scenario.reporter,
            null,
            scenario.plan,
            async function unrelatedOwner() {
                const delivery = activeDelivery();
                const snapshot = observedSnapshot(delivery);
                delivery.register(snapshot.owner, snapshot.resource, [], async function finalize() {
                    return undefined;
                });
                delivery.checkpoint(snapshot);
                delivery.stop(snapshot.owner, snapshot.interval, 'unrelated stop');
                return runResultFactory.build({ status: 'passed' });
            }
        );
        scope.assert.deepEqual(scenario.events, []);
        scope.assert.deepEqual(result.resourceChecks, []);
        scope.assert.equal(result.status, 'passed');
        return scope.assert.collect();
    })
]);
