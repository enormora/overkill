import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { planningInput } from '../test-support/benchmark-plan-input.ts';
import { defaultIntegrationProfile, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { createPlacementResolution, resolveCollectedHost, benchmarkPlacementForCases } from './collected-placement.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';

export const testNode: TestNode = suite('delegated collection placement defaults', [
    table({
        title: 'uses default pool assignment policies',
        cases: [ 'in-process', 'supervised-process' ] as const,
        caseTitle(processModel) {
            return `${processModel}`;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const processModel = scope.parameters;

            const original = planningInput();
            const input = {
                ...original,
                profile: processModel === 'in-process'
                    ? defaultMicrotestProfile({ execution: { processModel: 'in-process' } })
                    : defaultIntegrationProfile({ execution: { processModel } })
            };
            const result = await createPlacementResolution(input, null);
            require.defined(result);
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
    }),
    test('does not allocate worker placement for supervised collection', async function (scope) {
        const input = { ...planningInput(), planKind: 'supervised' as const };
        scope.assert.equal(await createPlacementResolution(input, null), null);
        return scope.assert.collect();
    }),
    table({
        title: 'uses the selected workload budget for placement',
        cases: [ 'small', 'missing' ],
        caseTitle(workload) {
            return `${workload}`;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const workload = scope.parameters;

            const input = planningInput();
            const entries = collectedRunCaseEntries(input.collectedPlan).map(function (entry) {
                return { ...entry, workId: { ...entry.workId, workload: { name: workload, params: {} } } };
            });
            const facts = await benchmarkPlacementForCases(input, entries);
            require.defined(facts);
            scope.assert.equal(facts.maximumWorkers, workload === 'small' ? 7 : 1);
            return scope.assert.collect();
        }
    })
]);
