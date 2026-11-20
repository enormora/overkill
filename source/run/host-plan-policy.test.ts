import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { observationPlan } from '../test-support/observation-lifetime.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { definition } from '../test-support/benchmark-placement-fixture.ts';
import { testNode as collection } from './run-plan-collection-policy.test.ts';
import { testNode as importedHosts } from './imported-host-policy.test.ts';
import { testNode as childCommands } from './supervised-child-policy.test.ts';
import { selectedAssignedCases } from './worker-pool-worker-plan.ts';
import { calibrationCapturePlan } from './default-run-engine.ts';

export const testNode = authoredSuite('host execution plan policy', [
    importedHosts,
    collection,
    childCommands,
    test('selects assigned case identities without changing discovered cases', function (scope: TestScope) {
        const plan = observationPlan();
        const selected = selectedAssignedCases(plan, [ plan.cases[0].id ]);
        scope.assert.equal(selected.cases[0], plan.cases[0]);
        scope.assert.equal(selected.discoveredCases, plan.discoveredCases);
        return scope.assert.collect();
    }),
    test('rejects empty and unknown case assignments', function (scope: TestScope) {
        const plan = observationPlan();
        for (const assigned of [ [], [ { ...plan.cases[0].id, title: 'missing' } ] ]) {
            scope.assert.throws(function () {
                selectedAssignedCases(plan, assigned);
            }, { message: 'Worker-pool test plan did not match assigned work identities.' });
        }
        return scope.assert.collect();
    }),
    test('preserves ordinary execution plans when calibration capture is disabled', function (scope: TestScope) {
        const plan = observationPlan();
        scope.assert.equal(calibrationCapturePlan(plan, null), plan);
        return scope.assert.collect();
    }),
    test('classifies unavailable calibration execution as a collection failure', function (scope: TestScope) {
        const engine = createTestEngine();
        const child = engine.createBenchmarkTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'measurement',
            definition: definition(),
            body() {
                return scope.assert.collect();
            },
            resourceBody() {
                return null;
            },
            workloads: [ { name: 'small', params: {} } ]
        });
        const plan = engine.createTestPlan(
            engine.createRoot({ title: 'root', annotations: {}, controls: {}, children: [ child ] })
        );
        scope.assert.throws(function () {
            calibrationCapturePlan(plan, {
                executionId: null,
                mode: 'capture',
                profile: 'bench',
                machine: { machineClass: 'unit', metadata: {} },
                references: [],
                saved: []
            });
        }, { name: 'RunCollectionError', message: 'Benchmark does not expose calibration resource execution.' });
        return scope.assert.collect();
    })
]);
