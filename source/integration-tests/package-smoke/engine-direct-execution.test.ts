import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFactory } from '@enormora/objectory';
import {
    createSuite,
    createTestCase,
    createTestPlan,
    execute,
    type RunResult,
    type TestCase
} from '@overkill-dev/engine';

type SmokeCaseDefinition = {
    readonly name: string;
    readonly expectedVerdict: 'fail' | 'pass';
    readonly assertionSummary: string;
};

const smokeCaseDefinitionFactory = createFactory<SmokeCaseDefinition>(function createSmokeCaseDefinition() {
    return {
        assertionSummary: 'passes',
        expectedVerdict: 'pass',
        name: 'passes'
    };
});

function createSmokeCase(definition: SmokeCaseDefinition): TestCase {
    return createTestCase({
        body(testContext) {
            if (definition.expectedVerdict === 'pass') {
                return testContext.assert.ok(true, definition.assertionSummary);
            }

            return testContext.assert.equal(1, 2, definition.assertionSummary);
        },
        metadata: { expectedVerdict: definition.expectedVerdict },
        name: definition.name
    });
}

await test('consumer imports @overkill-dev/engine and executes a TestPlan', async function () {
    const cases = [
        smokeCaseDefinitionFactory.build(),
        smokeCaseDefinitionFactory.build({
            assertionSummary: 'numbers differ',
            expectedVerdict: 'fail',
            name: 'fails'
        })
    ];
    const root = createSuite({
        children: cases.map(createSmokeCase),
        metadata: {},
        name: 'root'
    });
    const testPlan = createTestPlan(root);

    const result: RunResult = await execute(testPlan);

    assert.equal(result.summary.defined, 2);
    assert.equal(result.summary.discovered, 2);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.bySuite.root, { discovered: 2, executed: 2 });
    assert.deepStrictEqual(
        result.perTest.map(function toPublicResultShape(testResult) {
            return {
                id: testResult.id,
                outcome: testResult.outcome,
                verdict: testResult.verdict
            };
        }),
        [
            { id: 'root > passes', outcome: { kind: 'pass' }, verdict: 'pass' },
            {
                id: 'root > fails',
                outcome: {
                    checks: [
                        {
                            actual: 1,
                            expected: 2,
                            id: '1',
                            location: { column: null, file: '', line: null },
                            path: [],
                            summary: 'numbers differ'
                        }
                    ],
                    kind: 'fail'
                },
                verdict: 'fail'
            }
        ]
    );
});
