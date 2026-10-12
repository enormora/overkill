import { suite, test } from '../packages/test/test.entry-point.ts';
import { workload } from '../packages/bench/bench.entry-point.ts';
import { defineResource, withResource } from '../packages/test/resources.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { WorkloadInput } from '../engine/workload-input.ts';
import type { ResourceScope } from '../resources/resources.ts';
import { collectedRunPlanFromTestPlan, collectedWorkloadInputs } from './collected-run-plan.ts';
import { assertFrozenWorkloadInputs, assertSharedWorkloadInputs } from './workload-input-validation.ts';
import { caseResourceOwnershipBoundaries } from './resource-lifecycle-boundaries.ts';

function fixturePlan(scope: ResourceScope, inputs: readonly WorkloadInput[]): TestPlan {
    const engine = createTestEngine();
    const registry = defineResource({
        name: 'registry',
        scope: 'per-run',
        requirements: [],
        dispose: null,
        acquire() {
            return 'registry';
        },
        serializeHandle(handle) {
            return handle;
        },
        deserializeHandle(handle: string) {
            return handle;
        }
    });
    const fixture = defineResource({
        name: 'fixture',
        scope: 'per-run',
        requirements: [],
        dispose: null,
        dependencies: { registry },
        workload(parameters) {
            return parameters;
        },
        acquire({ workload: input }) {
            return input.parameters;
        },
        serializeHandle(handle) {
            return handle;
        },
        deserializeHandle(handle: WorkloadInput['parameters']) {
            return handle;
        }
    });
    const scopedFixture = Object.freeze({ ...fixture, scope });
    const consumer = defineResource({
        name: 'consumer',
        scope: 'per-run',
        requirements: [],
        dispose: null,
        dependencies: { fixture: scopedFixture },
        acquire({ dependencies }) {
            return dependencies.fixture;
        },
        serializeHandle(handle) {
            return handle;
        },
        deserializeHandle(handle: WorkloadInput['parameters']) {
            return handle;
        }
    });
    const scopedConsumer = Object.freeze({ ...consumer, scope });
    const children = inputs.map(function workloadCase(input, index) {
        return engine.createWorkloadTestCase({
            title: `case ${index}`,
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            workloads: [ {
                id: input.id,
                parameters: input.parameters,
                body: withResource(scopedConsumer, function (testScope) {
                    return testScope.assert.collect();
                })
            } ]
        });
    });
    return engine.createTestPlan(engine.createRoot({ title: 'root', annotations: {}, controls: {}, children }));
}

function resourceBoundaryKey(testCase: TestPlan['cases'][number], name: string): string {
    const boundary = caseResourceOwnershipBoundaries(testCase).find(function resourceMatches(entry) {
        return entry.resourceName === name;
    });
    if (boundary === undefined) {
        throw new Error(`Missing resource boundary ${name}.`);
    }
    return boundary.key;
}

export const testNode = suite('workload input validation', [
    test('splits every shared scope by full workload identity and preserves independent sharing', function (scope) {
        for (const lifetime of [ 'per-file', 'per-run', 'per-suite', 'shared-per-worker' ] as const) {
            const plan = fixturePlan(lifetime, [
                workload('small', { packages: 5 }),
                workload('large', { packages: 5 })
            ]);
            for (const name of [ 'fixture', 'consumer', 'registry' ]) {
                const keys = plan.cases.map(function boundaryKey(testCase) {
                    return resourceBoundaryKey(testCase, name);
                });
                if (name === 'registry') {
                    scope.assert.equal(keys[0], keys[1]);
                } else {
                    scope.assert.notEqual(keys[0], keys[1]);
                }
            }
        }
        return scope.assert.collect();
    }),
    test('rejects original parameter changes even when canonical identities agree', function (scope) {
        const original = fixturePlan('per-run', [ workload('text', { text: 'e\u{301}' }) ]);
        const recollected = fixturePlan('per-run', [ workload('text', { text: '\u{E9}' }) ]);
        const frozen = collectedWorkloadInputs(collectedRunPlanFromTestPlan(original));
        scope.assert.throws(function () {
            assertFrozenWorkloadInputs(recollected, frozen);
        }, { message: /changed after collection/v });
        scope.assert.throws(function () {
            assertFrozenWorkloadInputs(recollected, []);
        }, { message: /Missing frozen workload/v });
        return scope.assert.collect();
    }),
    test('rejects conflicting original inputs at a shared canonical boundary', function (scope) {
        const inputs = [ workload('text', { text: 'e\u{301}' }), workload('text', { text: '\u{E9}' }) ];
        scope.assert.throws(
            function () {
                assertSharedWorkloadInputs(collectedRunPlanFromTestPlan(fixturePlan('per-run', inputs)));
            },
            {
                message: /conflicting parameters/v
            }
        );
        assertSharedWorkloadInputs(collectedRunPlanFromTestPlan(fixturePlan('per-case', inputs)));
        return scope.assert.collect();
    }),
    test('snapshots low-level parameters before caller mutation', function (scope) {
        const input = workload('small', { packages: 5 });
        const parameters = { packages: 5 };
        const plan = fixturePlan('per-run', [ { id: input.id, parameters } ]);
        parameters.packages = 50;
        scope.assert.partialDeepEqual(plan.cases[0], { workloadParameters: { packages: 5 } });
        scope.assert.true(Object.isFrozen(plan.cases[0].workloadParameters));
        return scope.assert.collect();
    })
]);
