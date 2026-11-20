import { suite as authoredSuite, test } from '@overkill-dev/test';

import { definition } from '../test-support/benchmark-placement-fixture.ts';
import { planningInput, mixedMeasurements, mixedLifecycleInput } from '../test-support/benchmark-plan-input.ts';
import { collectedPlanning as createCollectedExecutionPlan } from '../test-support/collected-planning.ts';
import { testNode as profileDefaults } from './placement-profile-policy.test.ts';
import type { CollectedExecutionPlanInput as PlanningInput } from './collected-placement.ts';
import type { CollectedExecutionPlan } from './run-collected-planning.ts';
import { selectedCollectedRunPlan } from './run-selection.ts';
import { RunExecutionPlanError } from './run-errors.ts';

async function shardPlans(input: PlanningInput): Promise<readonly CollectedExecutionPlan[]> {
    const shards = 8;
    const collectedPlan = mixedMeasurements(input);
    return await Promise.all(Array.from({ length: shards }, async function shardPlan(_value, index) {
        return await createCollectedExecutionPlan({
            ...input,
            collectedPlan,
            request: { ...input.request, shard: { index: index + 1, total: shards } }
        });
    }));
}

export const testNode = authoredSuite('adaptive benchmark planning', [
    profileDefaults,
    test('caps lanes without rewriting request, host or profile facts', async function (scope) {
        const plan = await createCollectedExecutionPlan(planningInput());
        scope.assert.deepEqual<unknown, unknown>(plan.workerCount, {
            requested: 4,
            hostMaximum: 8,
            profileMaximum: 3,
            resolved: 2
        });
        scope.assert.equal(plan.benchmarkPlacement?.maximumWorkers, 7);
        scope.assert.equal(plan.placementPlan?.lanes.length, 2);
        scope.assert.true(
            plan.placementPlan?.units.every(function serial(unit) {
                return unit.scheduling === 'serial';
            })
        );
        return scope.assert.collect();
    }),
    test('does not let filtered sensitive work serialize selected artifact work', async function (scope) {
        const input = planningInput();
        const mixed = mixedMeasurements(input);
        const all = await createCollectedExecutionPlan({ ...input, collectedPlan: mixed });
        const selected = selectedCollectedRunPlan(mixed, {
            kind: 'filter',
            filter: { kind: 'equals', field: 'title', value: 'first' }
        });
        const filtered = await createCollectedExecutionPlan({ ...input, collectedPlan: selected });
        scope.assert.equal(all.benchmarkPlacement?.maximumWorkers, 1);
        scope.assert.equal(filtered.orderedCases.length, 1);
        scope.assert.equal(filtered.benchmarkPlacement?.maximumWorkers, 7);
        return scope.assert.collect();
    }),
    test('ignores timing budgets on an excluded workload of the same benchmark', async function (scope) {
        const input = planningInput();
        const size = definition();
        const collectedPlan = {
            ...input.collectedPlan,
            files: input.collectedPlan.files.map(function workloads(file) {
                return {
                    ...file,
                    cases: file.cases.map(function selectedWorkload(testCase) {
                        return {
                            ...testCase,
                            benchmark: {
                                ...size,
                                workloads: [ ...size.workloads, { name: 'timed', parameters: {} } ],
                                budgets: {
                                    ...size.budgets,
                                    timed: [ {
                                        metric: 'durationMicroseconds',
                                        maximum: 100,
                                        minimum: null,
                                        statistic: { kind: 'observed-maximum' as const }
                                    } ]
                                }
                            },
                            workId: {
                                familyVariant: null,
                                case: {
                                    file: file.file,
                                    title: testCase.title,
                                    params: testCase.params,
                                    suite: testCase.suitePath.map(function title(suiteEntry) {
                                        return suiteEntry.title;
                                    })
                                },
                                runtimes: [],
                                workload: { name: 'small', params: {} }
                            }
                        };
                    })
                };
            })
        };
        const plan = await createCollectedExecutionPlan({ ...input, collectedPlan });
        scope.assert.equal(plan.benchmarkPlacement?.maximumWorkers, 7);
        scope.assert.equal(plan.workerCount?.resolved, 2);
        return scope.assert.collect();
    }),
    test('evaluates eligibility after work-unit sharding', async function (scope) {
        const plans = await shardPlans(planningInput());
        const artifactShard = plans.find(function onlyArtifactWork(plan) {
            return plan.orderedCases.length === 1 && plan.orderedCases[0]?.testCase.title === 'first';
        });
        scope.assert.equal(artifactShard?.benchmarkPlacement?.maximumWorkers, 7);
        return scope.assert.collect();
    }),
    test('rejects mixed lifecycles that cannot fit the calibrated ceiling', async function (scope) {
        await scope.assert.rejects(async function incompatibleLifecycles() {
            return await createCollectedExecutionPlan(mixedLifecycleInput());
        }, {
            type: RunExecutionPlanError,
            message:
                'Execution plan is incompatible: Worker-pool execution requires 2 lifecycle lanes but only 1 are available.'
        });
        return scope.assert.collect();
    })
]);
