import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFactory } from '@enormora/objectory';
import {
    createEngine,
    createSuite,
    createTable,
    createTestCase,
    createTestPlan,
    execute,
    formatCaseId,
    type Engine,
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

function createSmokeCase(engine: Engine, definition: SmokeCaseDefinition): TestCase {
    return engine.createTestCase({
        body(testContext) {
            if (definition.expectedVerdict === 'pass') {
                testContext.assert.ok(true, definition.assertionSummary);
                return testContext.assert.done();
            }

            testContext.assert.equal(1, 2, definition.assertionSummary);
            return testContext.assert.done();
        },
        metadata: { expectedVerdict: definition.expectedVerdict },
        name: definition.name
    });
}

async function executeSmokePlan(engine: Engine): Promise<RunResult> {
    const cases = [
        smokeCaseDefinitionFactory.build(),
        smokeCaseDefinitionFactory.build({
            assertionSummary: 'numbers differ',
            expectedVerdict: 'fail',
            name: 'fails'
        })
    ];
    const root = engine.createSuite({
        children: cases.map(function toSmokeCase(smokeCase) {
            return createSmokeCase(engine, smokeCase);
        }),
        metadata: {},
        name: 'root'
    });

    return engine.execute(engine.createTestPlan(root));
}

function assertSmokeResult(result: RunResult): void {
    const passingCaseId = { file: null, name: 'passes', params: null, suite: [ 'root' ] };
    const failingCaseId = { file: null, name: 'fails', params: null, suite: [ 'root' ] };

    assert.equal(result.summary.defined, 3);
    assert.equal(result.summary.discovered, 2);
    assert.equal(result.summary.planned, 2);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.bySuite.root, { discovered: 2, executed: 2, planned: 2 });
    assert.deepStrictEqual(
        result.perTest.map(function toPublicResultShape(testResult) {
            return {
                id: testResult.id,
                outcome: testResult.outcome,
                verdict: testResult.verdict
            };
        }),
        [
            { id: passingCaseId, outcome: { kind: 'pass' }, verdict: 'pass' },
            {
                id: failingCaseId,
                outcome: {
                    failures: [
                        {
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
                            kind: 'assertion'
                        }
                    ],
                    kind: 'fail'
                },
                verdict: 'fail'
            }
        ]
    );
    assert.deepStrictEqual(
        result.perTest.map(function toFormattedId(testResult) {
            return formatCaseId(testResult.id);
        }),
        [ 'root > passes', 'root > fails' ]
    );
}

await test('consumer imports top-level @overkill-dev/engine exports and executes a TestPlan', async function () {
    const topLevelEngine: Engine = {
        createSuite,
        createTable,
        createTestCase,
        createTestPlan,
        execute,
        formatCaseId
    };

    assertSmokeResult(await executeSmokePlan(topLevelEngine));
});

await test('consumer imports createEngine() and executes a TestPlan', async function () {
    assertSmokeResult(await executeSmokePlan(createEngine()));
});
