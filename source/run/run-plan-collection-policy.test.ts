import { type TestNode, suite, test } from '@overkill-dev/test';

import { runPlanCollection } from '../test-support/run-plan-collection.ts';

import {
    createRunTestPlan,
    createRunTestPlanFromFiles,
    createRunTestPlanFromDirectEntrypoint
} from './run-test-plan.ts';

export const testNode: TestNode = suite('run collection boundary classification', [
    test(
        'uses default runtime collection policy for direct, discovered and frozen files',
        async function (scope) {
            const fixture = runPlanCollection(false);
            const direct = createRunTestPlanFromDirectEntrypoint(fixture.input.engine, fixture.file, fixture.source);
            const discovered = await createRunTestPlan(fixture.input);
            const frozen = await createRunTestPlanFromFiles({ ...fixture.input, files: [ fixture.file ] });
            scope.assert.deepEqual(
                [ direct, discovered, frozen ].map(function (plan) {
                    return plan.cases.map(function (entry) {
                        return entry.id;
                    });
                }),
                Array.from({ length: 3 }, function () {
                    return [ { file: 'case.ts', suite: [], params: null, title: 'case' } ];
                })
            );
            return scope.assert.collect();
        }
    ),
    test('classifies invalid direct plans as collection failures', function (scope) {
        const fixture = runPlanCollection(true);
        scope.assert.throws(function () {
            createRunTestPlanFromDirectEntrypoint(fixture.input.engine, fixture.file, fixture.source);
        }, { name: 'RunCollectionError', message: 'Failed to collect tests from runIfMain().' });
        return scope.assert.collect();
    }),
    test('classifies invalid loaded plans as collection failures', async function (scope) {
        const fixture = runPlanCollection(true);
        await scope.assert.rejects(async function () {
            await createRunTestPlan(fixture.input);
        }, { name: 'RunCollectionError', message: 'Failed to collect tests from run inputs.' });
        return scope.assert.collect();
    })
]);
