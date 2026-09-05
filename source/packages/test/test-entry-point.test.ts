import {
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    execute,
    ownsTestNode,
    serializeValue,
    runIfMain,
    type Suite,
    type Table,
    type TestBody,
    type TestCase,
    type TestPlan,
    type TestScope,
    type TestScope as OverkillScope
} from '../engine/engine.entry-point.ts';
import { createLineReporter } from '../reporter-line/reporter-line.entry-point.ts';
import {
    createTestFacade,
    defineMacro,
    runIfMain as rootRunIfMain,
    suite,
    table,
    test
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

type TableAuthoringExecution = {
    readonly bodyRows: readonly TableRow[];
    readonly caseTitleCalls: readonly string[];
    readonly plan: TestPlan;
    readonly result: Awaited<ReturnType<typeof execute>>;
    readonly rows: readonly TableRow[];
    readonly testNode: Table;
};

const placeholderExports: readonly PlaceholderExport[] = [
    { invoke: createTestFacade, name: 'createTestFacade' },
    { invoke: defineMacro, name: 'defineMacro' },
    { invoke: rootRunIfMain, name: 'runIfMain' }
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
}

export const testSuite = createOverkillSuite({
    title: 'source/packages/test/test-entry-point.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
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
            title: '@overkill-dev/test captures definition locations from the authoring callsite',
            metadata: {},
            body(scope: OverkillScope) {
                const testCase = test('located test', passingBody);
                const testNode = suite('located suite', [ testCase ]);

                scope.assert.match(
                    testCase.definitionLocation.file.replaceAll('\\', '/'),
                    /source\/packages\/test\/test-entry-point\.test\.[cm]?[jt]s$/u
                );
                scope.assert.equal(typeof testCase.definitionLocation.line, 'number');
                scope.assert.equal(typeof testCase.definitionLocation.column, 'number');
                scope.assert.match(
                    testNode.definitionLocation.file.replaceAll('\\', '/'),
                    /source\/packages\/test\/test-entry-point\.test\.[cm]?[jt]s$/u
                );
                scope.assert.equal(typeof testNode.definitionLocation.line, 'number');
                scope.assert.equal(typeof testNode.definitionLocation.column, 'number');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
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

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
