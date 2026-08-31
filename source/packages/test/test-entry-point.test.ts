import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import {
    createRoot,
    createTestPlan,
    execute,
    type TestBody,
    type TestCase,
    type TestPlan,
    ownsTestNode,
    type Suite,
    type TestScope
} from '../engine/engine.entry-point.ts';
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

const placeholderExports: readonly PlaceholderExport[] = [
    { invoke: createTestFacade, name: 'createTestFacade' },
    { invoke: defineMacro, name: 'defineMacro' },
    { invoke: rootRunIfMain, name: 'runIfMain' },
    { invoke: table, name: 'table' }
];

const invokeTest = test as (...parameters: readonly unknown[]) => unknown;
const invokeSuite = suite as (...parameters: readonly unknown[]) => unknown;

function passingBody(scope: TestScope): ReturnType<TestBody> {
    scope.assert.true(true);
    return scope.assert.collect();
}

function assertPassingSummary(scope: OverkillScope, summary: unknown): void {
    scope.assert.deepEqual(summary, {
        crashed: 0,
        defined: 2,
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
    const testCase = test({ body: passingBody, metadata: { tags: [ 'case' ] }, name: 'passes' });
    const testNode = suite({
        children: [ testCase ],
        metadata: { ownership: [ '@runtime' ], tags: [ 'suite' ] },
        name: 'runtime'
    });
    const root = createRoot({
        children: [ testNode ],
        metadata: { kind: 'microtest' },
        name: 'root'
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
        name: 'passes',
        params: null,
        suite: [ 'runtime' ]
    });
    scope.assert.equal(plannedCase.metadata.kind, 'microtest');
    scope.assert.deepEqual(plannedCase.metadata.tags, [ 'suite', 'case' ]);
    scope.assert.deepEqual(plannedCase.metadata.ownership, [ '@runtime' ]);
}

export const testSuite = createOverkillSuite({
    name: 'source/packages/test/test-entry-point.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: '@overkill-dev/test staged root authoring placeholders throw unavailable errors',
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
            name: '@overkill-dev/test test() and suite() create executable engine nodes',
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
            name: '@overkill-dev/test captures definition locations from the authoring callsite',
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
            name: '@overkill-dev/test delegates invalid authoring inputs to engine validation',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function createNamelessTest() {
                    test('', passingBody);
                }, { message: 'Test node name must not be empty.' });
                scope.assert.throws(function createSuiteWithPlainChild() {
                    invokeSuite('plain child', [ { kind: 'test' } ]);
                }, { message: 'Suite children must be engine-created TestNode values.' });
                scope.assert.throws(function createTestWithWrongArity() {
                    invokeTest();
                }, { message: 'test() requires (name, body) or ({ name, metadata, body }).' });
                scope.assert.throws(function createSuiteWithWrongArity() {
                    invokeSuite();
                }, { message: 'suite() requires (name, children) or ({ name, metadata, children }).' });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
