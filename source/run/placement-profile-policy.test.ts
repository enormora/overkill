import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { planningInput } from '../test-support/benchmark-plan-input.ts';
import { defaultIntegrationProfile, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { createPlacementResolution, resolveCollectedHost, benchmarkPlacementForCases } from './collected-placement.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';

export const testNode = authoredSuite('delegated collection placement defaults', [
    ...([ 'in-process', 'supervised-process' ] as const).map(function (processModel) {
        return authoredTest(
            `uses default pool assignment policies for a ${processModel} profile`,
            async function (scope: TestScope) {
                const original = planningInput();
                const input = {
                    ...original,
                    profile: processModel === 'in-process'
                        ? defaultMicrotestProfile({ execution: { processModel: 'in-process' } })
                        : defaultIntegrationProfile({ execution: { processModel } })
                };
                const result = await createPlacementResolution(input, null);
                scope.require.defined(result);
                scope.assert.equal(result.benchmarkPlacement, null);
                scope.assert.equal(
                    await resolveCollectedHost(input, collectedRunCaseEntries(input.collectedPlan)),
                    null
                );
                scope.assert.true(result.placementPlan.units.every(function (unit) {
                    return unit.workerLifecycle === 'reuse' && unit.id.mode === 'file';
                }));
                return scope.assert.collect();
            }
        );
    }),
    authoredTest('does not allocate worker placement for supervised collection', async function (scope: TestScope) {
        const input = { ...planningInput(), planKind: 'supervised' as const };
        scope.assert.equal(await createPlacementResolution(input, null), null);
        return scope.assert.collect();
    }),
    ...[ 'small', 'missing' ].map(function (workload) {
        return authoredTest(
            `uses only the selected ${workload} workload budget when estimating placement`,
            async function (scope: TestScope) {
                const input = planningInput();
                const entries = collectedRunCaseEntries(input.collectedPlan).map(function (entry) {
                    return { ...entry, workId: { ...entry.workId, workload: { name: workload, params: {} } } };
                });
                const facts = await benchmarkPlacementForCases(input, entries);
                scope.require.defined(facts);
                scope.assert.equal(facts.maximumWorkers, workload === 'small' ? 7 : 1);
                return scope.assert.collect();
            }
        );
    })
]);
