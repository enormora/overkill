import { test } from '@overkill-dev/test';

import {
    type TestNode as SubjectTestNode,
    createSuite,
    createTestCase
} from '../packages/engine/engine.entry-point.ts';

import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { assertDirectEntrypointCollectionMatches } from './direct-entrypoint-collection.ts';

function passingTest(title: string): SubjectTestNode {
    return createTestCase({
        annotations: {},
        body(scope) {
            scope.assert.true(true);
            return scope.assert.collect();
        },
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        title
    });
}

export const testNode = test(
    'direct entrypoint collection accepts decoded sibling cases and rejects changed case data',
    function (scope) {
        const expected = defaultRunEngine.createTestPlanFromTestFiles({
            files: [ {
                file: '/project/direct.test.ts',
                testNode: createSuite({
                    annotations: {},
                    children: [ passingTest('one'), passingTest('two') ],
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: 'shared suite'
                })
            } ],
            root: { annotations: {}, controls: {}, title: '/project' }
        });
        const transmitted = collectedRunPlanSchema.parse(collectedRunPlanFromTestPlan(expected));

        assertDirectEntrypointCollectionMatches(expected, transmitted);
        scope.assert.throws(function rejectChangedCase() {
            assertDirectEntrypointCollectionMatches(expected, {
                ...transmitted,
                files: transmitted.files.map(function changeFile(file) {
                    return {
                        ...file,
                        cases: file.cases.map(function changeCase(testCase) {
                            return { ...testCase, title: `${testCase.title} changed` };
                        })
                    };
                })
            });
        }, { message: /runIfMain\(\) argument does not match/u, name: 'RunCollectionError' });

        return scope.assert.collect();
    }
);
