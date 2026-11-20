import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { collectedMutationPlan } from '../../test-support/mutation-plan-fixture.ts';
import {
    campaignBaselineSchema,
    mutationLifecycleDataSchema,
    mutationCatalog,
    eligibleMutationCatalog
} from './mutation-catalog.ts';

export const testNode: TestNode = suite('mutation adapter evidence validation', [
    test('rejects duplicate baseline file filters', function (scope) {
        const { baseline } = mutationCoverageFixture('off');
        scope.assert.equal(
            campaignBaselineSchema.safeParse({ ...baseline, testFiles: [ 'first.test.ts', 'first.test.ts' ] }).success,
            false
        );
        return scope.assert.collect();
    }),
    test('rejects malformed retained run diagnostics', function (scope) {
        const { reply } = mutationCoverageFixture('off');
        scope.assert.equal(
            mutationLifecycleDataSchema
                .safeParse({ ...mutationLifecycleDataSchema.parse(reply.data), diagnostics: { invalid: 42 } })
                .success,
            false
        );
        return scope.assert.collect();
    }),
    test('rejects collected cases missing structural work identity', function (scope: TestScope) {
        const { baseline } = mutationCoverageFixture('off');
        const plan = collectedMutationPlan(baseline.catalog.map(function (entry) {
            return entry.work;
        }));
        const testCase = plan.files[0]?.cases[0];
        scope.require.defined(testCase);
        Reflect.deleteProperty(testCase, 'workId');
        scope.assert.throws(function () {
            mutationCatalog('/project', plan);
        }, { message: 'Collected test has no work identity.' });
        return scope.assert.collect();
    }),
    test('rejects a requested test-file selection with no eligible cases', function (scope) {
        const { baseline } = mutationCoverageFixture('off');
        const plan = collectedMutationPlan(baseline.catalog.map(function (entry) {
            return entry.work;
        }));
        scope.assert.throws(function () {
            eligibleMutationCatalog('/project', plan, [ 'missing.test.ts' ]);
        }, { message: 'Stryker test files matched no eligible tests.' });
        return scope.assert.collect();
    })
]);
