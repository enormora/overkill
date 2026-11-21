import { suite, test } from '@overkill-dev/test';

import { observationPlan } from '../test-support/observation-lifetime.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { definition } from '../test-support/benchmark-placement-fixture.ts';

import { selectedAssignedCases } from './worker-pool-worker-plan.ts';
import { calibrationCapturePlan } from './default-run-engine.ts';

export const testNode = suite('host execution plan policy', [
    test('selects assigned case identities without changing discovered cases', function (scope) {
        const plan = observationPlan();
        const selected = selectedAssignedCases(plan, [ plan.cases[0].id ]);
        scope.assert.equal(selected.cases[0], plan.cases[0]);
        scope.assert.equal(selected.discoveredCases, plan.discoveredCases);
        return scope.assert.collect();
    }),
    test('rejects empty and unknown case assignments', function (scope) {
        const plan = observationPlan();
        for (const assigned of [ [], [ { ...plan.cases[0].id, title: 'missing' } ] ]) {
            scope.assert.throws(function () {
                selectedAssignedCases(plan, assigned);
            }, { message: 'Worker-pool test plan did not match assigned work identities.' });
        }
        return scope.assert.collect();
    }),
    test('preserves ordinary execution plans when calibration capture is disabled', function (scope) {
        const plan = observationPlan();
        scope.assert.equal(calibrationCapturePlan(plan, null), plan);
        return scope.assert.collect();
    }),
    test('classifies unavailable calibration execution as a collection failure', function (scope) {
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
