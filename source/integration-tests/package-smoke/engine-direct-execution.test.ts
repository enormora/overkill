import { createFactory } from '@enormora/objectory';
import { defineCompositeAssertion } from '@overkill-dev/assert';
import * as doublesPackage from '@overkill-dev/doubles';
import {
    createEngine,
    createRoot,
    createSuite,
    createTable,
    createTestCase,
    createTestPlan,
    createTestPlanFromTestFiles,
    execute,
    formatCaseId,
    ownsTestNode,
    runIfMain,
    serializeValue,
    type Engine,
    type RunIfMainOptions,
    type RunResult,
    type SourceLocation,
    type TestCase,
    type TestNode,
    type TestRoot,
    type TestScope
} from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';

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

function plainDataShape(value: unknown): unknown {
    const { stringify } = JSON;
    const { parse } = JSON;

    return parse(stringify(value));
}

function failedAssertionLocation(result: RunResult): SourceLocation | null {
    const failedResult = result.perTest.at(1);

    if (failedResult?.outcome.kind !== 'fail') {
        return null;
    }

    const failure = failedResult.outcome.failures[0];

    if (failure.kind !== 'assertion') {
        return null;
    }

    return failure.checks[0].location;
}

function packagedSourceFile(location: SourceLocation | null): string {
    return location === null ? '' : location.file.replaceAll('\\', '/');
}

function locationLineType(location: SourceLocation | null): string {
    return location === null ? 'missing' : typeof location.line;
}

function locationColumnType(location: SourceLocation | null): string {
    return location === null ? 'missing' : typeof location.column;
}

const smokeResult = defineCompositeAssertion({
    name: 'smoke result',
    assert(check, result: RunResult, expectedDefined: number) {
        const passingCaseId = { file: null, name: 'passes', params: null, suite: [] };
        const failingCaseId = { file: null, name: 'fails', params: null, suite: [] };
        const location = failedAssertionLocation(result);
        const packagedFile = packagedSourceFile(location);
        const rootCounts = result.bySuite.root ?? null;
        const perTestShape = plainDataShape(
            result.perTest.map(function toPublicResultShape(testResult) {
                return {
                    id: testResult.id,
                    outcome: testResult.outcome,
                    verdict: testResult.verdict
                };
            })
        );

        return check.group([
            check.equal(result.summary.defined, expectedDefined),
            check.equal(result.summary.discovered, 2),
            check.equal(result.summary.planned, 2),
            check.equal(result.summary.passed, 1),
            check.equal(result.summary.failed, 1),
            check.equal(rootCounts, null),
            check.match(
                packagedFile,
                /target\/build\/source\/integration-tests\/package-smoke\/engine-direct-execution\.test\.js$/u
            ),
            check.equal(locationLineType(location), 'number'),
            check.equal(locationColumnType(location), 'number'),
            check.deepEqual(
                perTestShape,
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
            ),
            check.deepEqual(
                result.perTest.map(function toFormattedId(testResult) {
                    return formatCaseId(testResult.id);
                }),
                [ 'passes', 'fails' ]
            )
        ]);
    }
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
        body(testScope: TestScope) {
            if (definition.expectedVerdict === 'pass') {
                testScope.assert.true(true, { message: definition.assertionSummary });
                return testScope.assert.collect();
            }

            testScope.assert.equal(1, 2, { message: definition.assertionSummary });
            return testScope.assert.collect();
        },
        metadata: { expectedVerdict: definition.expectedVerdict },
        name: definition.name
    });
}

function createSmokeRoot(children: readonly TestNode[]): TestRoot {
    return createRoot({
        children,
        metadata: {},
        name: 'root'
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
    const root = engine.createRoot({
        children: cases.map(function toSmokeCase(smokeCase) {
            return createSmokeCase(engine, smokeCase);
        }),
        metadata: {},
        name: 'root'
    });

    return engine.execute(engine.createTestPlan(root));
}

export const testSuite = createSuite({
    name: 'package smoke',
    metadata: {},
    children: [
        createTestCase({
            name: 'consumer imports top-level @overkill-dev/engine exports and executes a TestPlan',
            metadata: {},
            async body(scope: TestScope) {
                const topLevelEngine: Engine = {
                    createSuite,
                    createTable,
                    createTestCase,
                    createRoot,
                    createTestPlan,
                    createTestPlanFromTestFiles,
                    execute,
                    formatCaseId,
                    ownsTestNode,
                    runIfMain
                };

                scope.assert(smokeResult, await executeSmokePlan(topLevelEngine), 8);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'consumer imports top-level @overkill-dev/engine runIfMain',
            metadata: {},
            async body(scope: TestScope) {
                const testCase = createTestCase({
                    body(testContext: TestScope) {
                        testContext.assert.true(true, { message: 'passes' });
                        return testContext.assert.collect();
                    },
                    metadata: {},
                    name: 'passes'
                });
                const options: RunIfMainOptions = {
                    runFacts: { smoke: true }
                };

                await runIfMain({ main: false } as ImportMeta, testCase, options);
                scope.assert.true(true, { message: 'runIfMain returned' });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'consumer imports createEngine() and executes a TestPlan',
            metadata: {},
            async body(scope: TestScope) {
                scope.assert(smokeResult, await executeSmokePlan(createEngine()), 2);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'consumer imports @overkill-dev/assert reference and executes it through @overkill-dev/engine',
            metadata: {},
            async body(scope: TestScope) {
                const testCase = createTestCase({
                    body(testScope: TestScope) {
                        testScope.assert(resultOk, { ok: true });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    name: 'uses assert package'
                });
                const result = await execute(createTestPlan(createSmokeRoot([ testCase ])));

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'consumer imports top-level @overkill-dev/doubles facade',
            metadata: {},
            async body(scope: TestScope) {
                scope.assert.deepEqual(Object.keys(doublesPackage), [
                    'doubleUsage',
                    'rule',
                    'testAsyncDisposable',
                    'testAsyncIterable',
                    'testAsyncIterator',
                    'testDisposable',
                    'testDouble',
                    'testIterable',
                    'testIterator'
                ]);
                const loadValue = doublesPackage.testDouble.returns('value');

                scope.assert.deepEqual(
                    {
                        returned: loadValue(),
                        interactionCount: loadValue.interactionCount,
                        status: loadValue.lastResult?.status,
                        sequenced: doublesPackage.testDouble({
                            fallback: doublesPackage.rule.sequence([ 'first', 'second' ])
                        })()
                    },
                    {
                        returned: 'value',
                        interactionCount: 1,
                        status: 'returned',
                        sequenced: 'first'
                    }
                );

                const testCase = createTestCase({
                    body(testScope: TestScope) {
                        const saveValue = doublesPackage.testDouble.returns('saved');

                        saveValue('id');
                        testScope.assert(doublesPackage.doubleUsage.calledOnceWith, saveValue, [ 'id' ]);
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    name: 'uses doubles assertions'
                });
                const result = await execute(createTestPlan(createSmokeRoot([ testCase ])));

                scope.assert.deepEqual(
                    {
                        failed: result.summary.failed,
                        passed: result.summary.passed
                    },
                    {
                        failed: 0,
                        passed: 1
                    }
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
