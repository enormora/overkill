import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFactory } from '@enormora/objectory';
import { defineCompositeAssertion } from '@overkill-dev/assert';
import * as doublesPackage from '@overkill-dev/doubles';
import {
    createEngine,
    createSuite,
    createTable,
    createTestCase,
    createTestPlan,
    execute,
    formatCaseId,
    serializeValue,
    type Engine,
    type RunResult,
    type SourceLocation,
    type TestCase
} from '@overkill-dev/engine';

type SmokeCaseDefinition = {
    readonly name: string;
    readonly expectedVerdict: 'fail' | 'pass';
    readonly assertionSummary: string;
};

type ResultOk = {
    readonly ok: boolean;
};

const resultOk = defineCompositeAssertion({
    assert(check, result: ResultOk) {
        return check.true(result.ok);
    },
    name: 'resultOk'
});

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
                testContext.assert.true(true, { message: definition.assertionSummary });
                return testContext.assert.done();
            }

            testContext.assert.equal(1, 2, { message: definition.assertionSummary });
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

function failedAssertionLocation(result: RunResult): SourceLocation {
    const failedResult = result.perTest.at(1);

    assert.notEqual(failedResult, undefined);

    if (failedResult?.outcome.kind !== 'fail') {
        throw new TypeError('Expected second test result to fail.');
    }

    const failure = failedResult.outcome.failures[0];

    if (failure.kind !== 'assertion') {
        throw new TypeError('Expected assertion failure.');
    }

    return failure.checks[0].location;
}

function assertPackagedSourceLocation(location: SourceLocation): void {
    assert.match(
        location.file.replaceAll('\\', '/'),
        /target\/build\/source\/integration-tests\/package-smoke\/engine-direct-execution\.test\.js$/u
    );
    assert.equal(typeof location.line, 'number');
    assert.equal(typeof location.column, 'number');
}

function assertSmokeSummary(result: RunResult): void {
    assert.equal(result.summary.defined, 3);
    assert.equal(result.summary.discovered, 2);
    assert.equal(result.summary.planned, 2);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 1);
    assert.deepStrictEqual(result.bySuite.root, { discovered: 2, executed: 2, planned: 2 });
}

function assertSmokeResult(result: RunResult): void {
    const passingCaseId = { file: null, name: 'passes', params: null, suite: [ 'root' ] };
    const failingCaseId = { file: null, name: 'fails', params: null, suite: [ 'root' ] };
    const location = failedAssertionLocation(result);

    assertPackagedSourceLocation(location);
    assertSmokeSummary(result);
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
                                    actual: serializeValue(1),
                                    diff: null,
                                    expected: serializeValue(2),
                                    id: '1',
                                    kind: 'leaf',
                                    location,
                                    path: [],
                                    source: 'assert',
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

await test('consumer imports @overkill-dev/assert reference and executes it through @overkill-dev/engine', async function () {
    const testCase = createTestCase({
        body(testContext) {
            testContext.assert(resultOk, { ok: true });
            return testContext.assert.done();
        },
        metadata: {},
        name: 'uses assert package'
    });
    const result = await execute(createTestPlan(testCase));

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

await test('consumer imports top-level @overkill-dev/doubles facade', function () {
    assert.deepEqual(Object.keys(doublesPackage), []);
});
