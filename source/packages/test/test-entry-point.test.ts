import {
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    execute,
    ownsTestNode,
    serializeValue,
    type SourceLocation,
    type Suite,
    type Table,
    type TestBody,
    type TestCase,
    type TestNode,
    type TestPlan,
    type TestOutcome,
    type TestScope,
    type TestScope as OverkillScope
} from '../engine/engine.entry-point.ts';
import {
    createTestFacade,
    defineMacro,
    defineParameterizedTestBody,
    doubleUsage,
    rule,
    suite,
    table,
    test,
    type TestDouble,
    type TestIterator,
    testDouble,
    testIterator
} from './test.entry-point.ts';

type PlaceholderExport = {
    readonly invoke: (...parameters: readonly unknown[]) => never;
    readonly name: string;
};
type RootAuthoringExecution = {
    readonly plannedCase: TestPlan['discoveredCases'][number] | undefined;
    readonly result: Awaited<ReturnType<typeof execute>>;
    readonly testCase: TestCase;
    readonly testNode: Suite;
};

type TableRow = {
    readonly value: number;
};

type NameData = {
    readonly name: string;
};
type LoadValue = (id: string) => string;
type RootLoadValue = TestDouble<LoadValue>;
type RootSequencedValue = TestDouble<(...parameters: readonly unknown[]) => unknown>;
type RootEvents = TestIterator<string, undefined>;

type TableAuthoringExecution = {
    readonly bodyRows: readonly TableRow[];
    readonly caseTitleCalls: readonly string[];
    readonly plan: TestPlan;
    readonly result: Awaited<ReturnType<typeof execute>>;
    readonly rows: readonly TableRow[];
    readonly testNode: Table;
};

const placeholderExports: readonly PlaceholderExport[] = [
    { invoke: createTestFacade, name: 'createTestFacade' }
];

const invokeTest = test as (...parameters: readonly unknown[]) => unknown;
const invokeSuite = suite as (...parameters: readonly unknown[]) => unknown;

function passingBody(scope: TestScope): ReturnType<TestBody> {
    scope.assert.true(true);
    return scope.assert.collect();
}

function assertPassingSummary(scope: OverkillScope, summary: unknown): void {
    scope.assert.deepEqual({
        ...summary as Awaited<ReturnType<typeof execute>>['summary'],
        defined: null
    }, {
        crashed: 0,
        defined: null,
        discovered: 1,
        failed: 0,
        inconclusive: 0,
        passed: 1,
        planned: 1,
        resourceExhausted: 0,
        runtimePolicy: 0,
        skipped: 0
    });
}

async function executeRootAuthoredNode(): Promise<RootAuthoringExecution> {
    const testCase = test({ body: passingBody, metadata: { tags: [ 'case' ] }, title: 'passes' });
    const testNode = suite({
        children: [ testCase ],
        metadata: { ownership: [ '@runtime' ], tags: [ 'suite' ] },
        title: 'runtime'
    });
    const root = createRoot({
        children: [ testNode ],
        metadata: { kind: 'microtest' },
        title: 'root'
    });
    const plan = createTestPlan(root);

    return {
        plannedCase: plan.discoveredCases[0],
        result: await execute(plan),
        testCase,
        testNode
    };
}

function assertRootAuthoredCase(scope: OverkillScope, plannedCase: RootAuthoringExecution['plannedCase']): void {
    scope.require.defined(plannedCase);
    scope.assert.deepEqual(plannedCase.id, {
        file: null,
        title: 'passes',
        params: null,
        suite: [ 'runtime' ]
    });
    scope.assert.equal(plannedCase.metadata.kind, 'microtest');
    scope.assert.deepEqual(plannedCase.metadata.tags, [ 'suite', 'case' ]);
    scope.assert.deepEqual(plannedCase.metadata.ownership, [ '@runtime' ]);
}

function assertTableSummary(scope: OverkillScope, summary: unknown): void {
    scope.assert.deepEqual({
        ...summary as Awaited<ReturnType<typeof execute>>['summary'],
        defined: null
    }, {
        crashed: 0,
        defined: null,
        discovered: 2,
        failed: 0,
        inconclusive: 0,
        passed: 2,
        planned: 2,
        resourceExhausted: 0,
        runtimePolicy: 0,
        skipped: 0
    });
}

function parameterIdentity(parameters: unknown): string {
    return JSON.stringify(serializeValue(parameters));
}

async function executeTableAuthoredNode(): Promise<TableAuthoringExecution> {
    const rows: readonly TableRow[] = [ { value: 1 }, { value: 2 } ];
    const bodyRows: TableRow[] = [];
    const caseTitleCalls: string[] = [];
    const testNode = table({
        cases: rows,
        caseTitle(parameters, index) {
            caseTitleCalls.push(`${index}:${parameters.value}`);
            return `row ${index + 1}`;
        },
        metadata: { tags: [ 'table' ] },
        test(testScope) {
            bodyRows.push(testScope.parameters);
            testScope.assert.true(rows.includes(testScope.parameters));
            return testScope.assert.collect();
        },
        title: 'rows'
    });
    const root = createRoot({
        children: [ testNode ],
        metadata: { kind: 'microtest' },
        title: 'root'
    });
    const plan = createTestPlan(root);

    return {
        bodyRows,
        caseTitleCalls,
        plan,
        result: await execute(plan),
        rows,
        testNode
    };
}

function caseIdsFor(plan: TestPlan): readonly unknown[] {
    return plan.discoveredCases.map(function toCaseId(testCase) {
        return {
            file: testCase.id.file,
            params: testCase.id.params,
            suite: Array.from(testCase.id.suite),
            title: testCase.id.title
        };
    });
}

function assertTableCases(scope: OverkillScope, execution: TableAuthoringExecution): void {
    scope.assert.deepEqual(caseIdsFor(execution.plan), [
        { file: null, params: parameterIdentity(execution.rows[0]), suite: [ 'rows' ], title: 'row 1' },
        { file: null, params: parameterIdentity(execution.rows[1]), suite: [ 'rows' ], title: 'row 2' }
    ]);
    scope.assert.deepEqual(
        execution.plan.discoveredCases.map(function toTagList(testCase) {
            return testCase.metadata.tags.join(',');
        }),
        [ 'table', 'table' ]
    );
}

type FailOutcome = Extract<TestOutcome, { readonly kind: 'fail'; }>;

function firstFailedOutcome(result: Awaited<ReturnType<typeof execute>>): FailOutcome {
    const testResult = result.perTest[0];

    if (testResult === undefined || testResult.outcome?.kind !== 'fail') {
        throw new TypeError('Expected failing test result.');
    }

    return testResult.outcome;
}

function firstFailedCheckSourceLocations(result: Awaited<ReturnType<typeof execute>>): readonly SourceLocation[] {
    const failure = firstFailedOutcome(result).failures[0];

    if (failure.kind !== 'assertion') {
        throw new TypeError('Expected assertion failure.');
    }

    return failure.checks[0].sourceLocations;
}

async function executeAuthoredNode(testNode: TestNode): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(createTestPlan(createRoot({
        children: [ testNode ],
        metadata: {},
        title: 'root'
    })));
}

function assertSourceLocationInThisFile(scope: OverkillScope, location: SourceLocation): void {
    scope.assert.match(
        location.file.replaceAll('\\', '/'),
        /source\/packages\/test\/test-entry-point\.test\.[cm]?[jt]s$/u
    );
}

function assertFirstSourceLocationInThisFile(
    scope: OverkillScope,
    sourceLocations: readonly SourceLocation[]
): void {
    const sourceLocation = sourceLocations[0];
    scope.require.defined(sourceLocation);
    assertSourceLocationInThisFile(scope, sourceLocation);
}

function assertMacroLocationForwarding(
    scope: OverkillScope,
    testCase: TestCase,
    failedSourceLocations: readonly SourceLocation[]
): void {
    const macroDefinitionLocation = testCase.definitionLocations[0];
    scope.require.defined(macroDefinitionLocation);

    scope.assert.equal(testCase.definitionLocations.length, 2);
    scope.assert.equal(failedSourceLocations.length, 2);
    assertSourceLocationInThisFile(scope, macroDefinitionLocation);
    assertFirstSourceLocationInThisFile(scope, failedSourceLocations);
}

function assertParameterizedBodyLocationForwarding(
    scope: OverkillScope,
    testCase: TestCase,
    failedSourceLocations: readonly SourceLocation[]
): void {
    scope.assert.equal(testCase.definitionLocations.length, 1);
    scope.assert.equal(failedSourceLocations.length, 2);
    assertFirstSourceLocationInThisFile(scope, failedSourceLocations);
}

function createMissingNameTest(title: string): TestCase {
    return test(title, function checkName(testScope) {
        testScope.assert.equal('', 'Ada', { message: 'missing name' });
        return testScope.assert.collect();
    });
}

function checkParameterizedName(testScope: TestScope, data: NameData): ReturnType<TestBody> {
    testScope.assert.equal(data.name, 'Ada', { message: 'wrong name' });
    return testScope.assert.collect();
}

function assertDefinitionLocationInThisFile(
    scope: OverkillScope,
    sourceLocations: readonly SourceLocation[]
): void {
    const sourceLocation = sourceLocations[0];
    scope.require.defined(sourceLocation);

    assertSourceLocationInThisFile(scope, sourceLocation);
    scope.assert.equal(typeof sourceLocation.line, 'number');
    scope.assert.equal(typeof sourceLocation.column, 'number');
}

function createSequencedValue(): RootSequencedValue {
    return testDouble({
        fallback: rule.sequence([ 'first', 'second' ])
    });
}

function exerciseRootDoubles(
    loadValue: RootLoadValue,
    sequencedValue: RootSequencedValue,
    events: RootEvents
): void {
    loadValue('id');
    sequencedValue();
    events.next();
}

function assertRootDoubleUsage(
    testScope: TestScope,
    loadValue: RootLoadValue,
    sequencedValue: RootSequencedValue,
    events: RootEvents
): void {
    testScope.assert(doubleUsage.calledOnceWith, loadValue, [ 'id' ]);
    testScope.assert(doubleUsage.calledOnce, sequencedValue);
    testScope.assert(doubleUsage.yieldedExactly, events, [ 'created' ]);
}

function rootDoublesBody(testScope: TestScope): ReturnType<TestBody> {
    const loadValue = testDouble.returns<LoadValue>('value');
    const sequencedValue = createSequencedValue();
    const events = testIterator.yields([ 'created' ]);

    exerciseRootDoubles(loadValue, sequencedValue, events);
    assertRootDoubleUsage(testScope, loadValue, sequencedValue, events);
    return testScope.assert.collect();
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/packages/test/test-entry-point.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test staged root authoring placeholders throw unavailable errors',
            metadata: {},
            body(scope: OverkillScope) {
                for (const placeholderExport of placeholderExports) {
                    scope.assert.throws(function invokePlaceholder() {
                        placeholderExport.invoke('ignored');
                    }, {
                        message: [
                            `The @overkill-dev/test ${placeholderExport.name}() authoring API`,
                            'is not implemented yet.'
                        ]
                            .join(' ')
                    });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test test() and suite() create executable engine nodes',
            metadata: {},
            async body(scope: OverkillScope) {
                const execution = await executeRootAuthoredNode();

                scope.assert.equal(ownsTestNode(execution.testCase), true);
                scope.assert.equal(ownsTestNode(execution.testNode), true);
                assertRootAuthoredCase(scope, execution.plannedCase);
                assertPassingSummary(scope, execution.result.summary);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test table() creates parameterized executable engine nodes',
            metadata: {},
            async body(scope: OverkillScope) {
                const execution = await executeTableAuthoredNode();

                scope.assert.equal(ownsTestNode(execution.testNode), true);
                scope.assert.deepEqual(execution.caseTitleCalls, [ '0:1', '1:2' ]);
                assertTableCases(scope, execution);
                scope.assert.equal(execution.bodyRows[0], execution.rows[0]);
                scope.assert.equal(execution.bodyRows[1], execution.rows[1]);
                assertTableSummary(scope, execution.result.summary);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test root doubles pass through engine assertions',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeAuthoredNode(test('uses root doubles', rootDoublesBody));

                assertPassingSummary(scope, result.summary);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test defineMacro() forwards definition and assertion source locations',
            metadata: {},
            async body(scope: OverkillScope) {
                const checkMissingName = defineMacro(createMissingNameTest);
                const testCase = checkMissingName('requires name');
                const result = await executeAuthoredNode(testCase);
                const failedSourceLocations = firstFailedCheckSourceLocations(result);

                assertMacroLocationForwarding(scope, testCase, failedSourceLocations);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test defineParameterizedTestBody() forwards assertion source locations',
            metadata: {},
            async body(scope: OverkillScope) {
                const checkName = defineParameterizedTestBody(checkParameterizedName);
                const testCase = test('checks name', checkName({ name: 'Grace' }));
                const result = await executeAuthoredNode(testCase);
                const failedSourceLocations = firstFailedCheckSourceLocations(result);

                assertParameterizedBodyLocationForwarding(scope, testCase, failedSourceLocations);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test captures definition locations from the authoring callsite',
            metadata: {},
            body(scope: OverkillScope) {
                const testCase = test('located test', passingBody);
                const locatedSuite = suite('located suite', [ testCase ]);

                assertDefinitionLocationInThisFile(scope, testCase.definitionLocations);
                assertDefinitionLocationInThisFile(scope, locatedSuite.definitionLocations);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: '@overkill-dev/test delegates invalid authoring inputs to engine validation',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function createNamelessTest() {
                    test('', passingBody);
                }, { message: 'Test node title must not be empty.' });
                scope.assert.throws(function createSuiteWithPlainChild() {
                    invokeSuite('plain child', [ { kind: 'test' } ]);
                }, { message: 'Suite children must be engine-created TestNode values.' });
                scope.assert.throws(function createTestWithWrongArity() {
                    invokeTest();
                }, { message: 'test() requires (title, body) or ({ title, metadata, body }).' });
                scope.assert.throws(function createSuiteWithWrongArity() {
                    invokeSuite();
                }, { message: 'suite() requires (title, children) or ({ title, metadata, children }).' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
