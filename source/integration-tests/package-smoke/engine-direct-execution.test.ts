import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import { P } from 'ts-pattern';
import { createFactory } from '@enormora/objectory';
import { requirePublishedCompositeReference } from '../../test-support/assertion-reference-boundary.ts';
import type * as EnginePackage from '../../packages/engine/engine.entry-point.ts';
import type * as DoublesPackage from '../../packages/doubles/doubles.entry-point.ts';
import type * as TestPackage from '../../packages/test/test.entry-point.ts';
import type * as AssertionPackage from '../../packages/assert/assert.entry-point.ts';
import type {
    Engine,
    RunResult,
    SourceLocation,
    TestCase,
    TestNode as SubjectTestNode,
    TestRoot
} from '../../packages/engine/engine.entry-point.ts';

import { resolvePackagedExport } from './support/packaged-module.ts';

const { runIfMain } = await import(await resolvePackagedExport('@overkill-dev/test')) as typeof TestPackage;

const { defineCompositeAssertion: defineSubjectCompositeAssertion } = await import(
    await resolvePackagedExport('@overkill-dev/assert')
) as typeof AssertionPackage;
const doublesPackage = await import(
    await resolvePackagedExport('@overkill-dev/doubles')
) as typeof DoublesPackage;
const { matches } = doublesPackage;
const {
    createEngine,
    parseWitnessFile,
    createPropertyTestCase,
    createBenchmarkTestCase,
    createRoot,
    createSuite,
    createSkippedTestCase,
    createTable,
    createTestCase,
    createThrowingTestCase,
    createWorkloadTestCase,
    createTestPlan,
    createTestPlanFromTestFiles,
    defineTestFamily,
    execute,
    formatCaseId,
    ownsTestNode,
    prepareFamily,
    serializeValue
} = await import(
    await resolvePackagedExport('@overkill-dev/engine')
) as typeof EnginePackage;

type SmokeCaseDefinition = {
    readonly name: string;
    readonly expectedVerdict: 'fail' | 'pass';
    readonly assertionSummary: string;
};

type ResultOk = {
    readonly ok: boolean;
};

const resultOk = defineSubjectCompositeAssertion({
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

    if (failedResult?.outcome?.kind !== 'fail') {
        return null;
    }

    const failure = failedResult.outcome.failures[0];

    if (failure.kind !== 'assertion') {
        return null;
    }

    return failure.checks[0].sourceLocations[0];
}

function packagedSourceFile(location: SourceLocation | null): string {
    return location?.kind === 'known' ? location.file.replaceAll('\\', '/') : '';
}

function locationLineType(location: SourceLocation | null): string {
    return location?.kind === 'known' ? typeof location.line : 'missing';
}

function locationColumnType(location: SourceLocation | null): string {
    return location?.kind === 'known' ? typeof location.column : 'missing';
}

const smokeResult = defineCompositeAssertion({
    name: 'smoke result',
    assert(check, result: RunResult, expectedDefined: number) {
        const passingCaseId = { file: null, title: 'passes', params: null, suite: [] };
        const failingCaseId = { file: null, title: 'fails', params: null, suite: [] };
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
            check.equal(packagedFile, import.meta.filename.replaceAll('\\', '/')),
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
                                            path: [],
                                            source: 'assert',
                                            sourceLocations: [ location ],
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
        definitionLocations: [ { kind: 'unknown' } ],
        body(testScope) {
            if (definition.expectedVerdict === 'pass') {
                testScope.assert.true(true, { message: definition.assertionSummary });
                return testScope.assert.collect();
            }

            testScope.assert.equal(1, 2, { message: definition.assertionSummary });
            return testScope.assert.collect();
        },
        annotations: {},
        controls: {},
        title: definition.name
    });
}

function createSmokeRoot(children: readonly SubjectTestNode[]): TestRoot {
    return createRoot({
        children,
        annotations: {},
        controls: {},
        title: 'root'
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
        annotations: {},
        controls: {},
        title: 'root'
    });

    return engine.execute(engine.createTestPlan(root));
}

const smokeRuntimeFamily = defineTestFamily({
    id: '@example/package-smoke',
    version: '1',
    module: null,
    features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
    parseSettings() {
        return null;
    },
    async load() {
        return {
            async prepare({ testPlan }) {
                return {
                    testPlan,
                    facts: null,
                    async collect() {
                        return { kind: 'runtime', facts: null };
                    },
                    async dispose() {
                        return undefined;
                    }
                };
            }
        };
    }
});

export const testNode = suite('Installed engine interoperability', [
    test('engine prepares and executes a family through top-level exports', async function (scope) {
        const testPlan = createTestPlan(createSmokeRoot([ createSkippedTestCase({
            title: 'planned skip',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            reason: 'smoke case'
        }) ]));
        const controller = new AbortController();
        const { signal } = controller;
        await using prepared = await prepareFamily({
            testPlan,
            testFamily: smokeRuntimeFamily,
            settings: null,
            projectRoot: process.cwd(),
            signal
        });
        const collected = await prepared.collect({ workIds: [ prepared.testPlan.cases[0].workId ], signal });
        const result = await execute(collected, {
            debug: { mode: 'off' },
            signal,
            execution: { mode: 'serial-in-process' },
            retryPolicy: null,
            reporters: [],
            runFacts: {},
            startedAt: '2026-01-01T00:00:00.000Z'
        });
        scope.assert.equal(result.summary.skipped, 1);
        return scope.assert.collect();
    }),
    test('engine parses simulation witnesses', function (scope) {
        const witness = parseWitnessFile({
            version: 1,
            kind: 'simulation',
            producedBy: { library: 'simulator', libraryVersion: '1' },
            case: { file: null, params: null, suite: [], title: 'scenario' },
            seed: null,
            simulation: { name: 'backend', payload: {} },
            resource: null,
            scenario: null,
            runtimeSnapshot: null,
            faultConfiguration: null
        });
        scope.assert.equal(witness.kind, 'simulation');
        return scope.assert.collect();
    }),
    test(
        'imports top-level @overkill-dev/engine exports and executes a TestPlan',
        async function (scope) {
            const topLevelEngine: Engine = {
                createPropertyTestCase,
                createBenchmarkTestCase,
                createSuite,
                createSkippedTestCase,
                createTable,
                createTestCase,
                createThrowingTestCase,
                createWorkloadTestCase,
                createRoot,
                createTestPlan,
                createTestPlanFromTestFiles,
                execute,
                formatCaseId,
                ownsTestNode,
                prepareFamily
            };

            const baseline = createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                annotations: {},
                controls: {},
                title: 'definition count baseline',
                body() {
                    throw new Error('The definition count baseline must not execute.');
                }
            });
            const definedBefore = createTestPlan(createSmokeRoot([ baseline ])).defined;
            scope.assert(smokeResult, await executeSmokePlan(topLevelEngine), definedBefore + 2);

            return scope.assert.collect();
        }
    ),
    test('integration launcher returns for imported metadata', async function (scope) {
        const testCase = createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            body(testContext) {
                testContext.assert.true(true, { message: 'passes' });
                return testContext.assert.collect();
            },
            annotations: {},
            controls: {},
            title: 'passes'
        });

        await runIfMain({ main: false } as ImportMeta, testCase, { reporters: [] });
        scope.assert.true(true, { message: 'runIfMain returned' });

        return scope.assert.collect();
    }),
    test('imports createEngine() and executes a TestPlan', async function (scope) {
        scope.assert(smokeResult, await executeSmokePlan(createEngine()), 2);

        return scope.assert.collect();
    }),
    test(
        'imports @overkill-dev/assert reference and executes it through @overkill-dev/engine',
        async function (scope) {
            const testCase = createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                body(testScope) {
                    testScope.assert(resultOk, { ok: true });
                    return testScope.assert.collect();
                },
                annotations: {},
                controls: {},
                title: 'uses assert package'
            });
            const result = await execute(createTestPlan(createSmokeRoot([ testCase ])));

            scope.assert.equal(result.summary.passed, 1);
            scope.assert.equal(result.summary.failed, 0);

            return scope.assert.collect();
        }
    ),
    test('imports top-level @overkill-dev/doubles facade', async function (scope) {
        scope.assert.deepEqual(Object.keys(doublesPackage), [
            'doubleUsage',
            'matches',
            'rule',
            'testAsyncDisposable',
            'testAsyncIterable',
            'testAsyncIterator',
            'testDisposable',
            'testDouble',
            'testIterable',
            'testIterator'
        ]);

        const patternedDoublePatterned = doublesPackage.testDouble<(id: string) => string>({
            rules: [ doublesPackage.rule.when(matches(P.string)).returns('matched') ]
        });
        scope.assert.equal(patternedDoublePatterned('id'), 'matched');
        const { calledOnceWith } = doublesPackage.doubleUsage;
        requirePublishedCompositeReference(calledOnceWith);
        scope.assert(calledOnceWith, patternedDoublePatterned, [
            matches(P.string)
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
            definitionLocations: [ { kind: 'unknown' } ],
            body(testScope) {
                const saveValue = doublesPackage.testDouble.returns('saved');

                saveValue('id');
                testScope.assert(doublesPackage.doubleUsage.calledOnceWith, saveValue, [ 'id' ]);
                return testScope.assert.collect();
            },
            annotations: {},
            controls: {},
            title: 'uses doubles assertions'
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
    })
]);
