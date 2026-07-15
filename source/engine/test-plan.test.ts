import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { createTestPlan } from './test-plan.ts';
import { createSuite, createTable, createTestCase } from './test-node.ts';

registerTest('createTestPlan() expands suites and tables into executable cases', function () {
    const root = createSuite({
        children: [
            createTestCase({
                body(testContext) {
                    return testContext.assert.ok(true, 'passes');
                },
                metadata: { local: true },
                name: 'first'
            }),
            createTable({
                cases: [
                    {
                        body(testContext) {
                            return testContext.assert.ok(true, 'row passes');
                        },
                        metadata: { row: 1 },
                        name: 'row 1',
                        parameters: { value: 1 }
                    }
                ],
                metadata: { table: true },
                name: 'rows'
            })
        ],
        metadata: { inherited: true },
        name: 'root'
    });

    const testPlan = createTestPlan(root);

    assert.deepStrictEqual(
        testPlan.cases.map(function toComparableTestCase(testCase) {
            return {
                id: testCase.id,
                metadata: testCase.metadata,
                suitePath: testCase.suitePath
            };
        }),
        [
            {
                id: 'root > first',
                metadata: { inherited: true, local: true },
                suitePath: [ 'root' ]
            },
            {
                id: 'root > rows > row 1',
                metadata: { inherited: true, row: 1, table: true },
                suitePath: [ 'root', 'rows' ]
            }
        ]
    );
});
