import {
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    execute,
    ownsTestNode,
    type SourceLocation,
    type Suite,
    type TestCase,
    type TestPlan,
    type TestScope as OverkillScope
} from '../engine/engine.entry-point.ts';
import { createTestFacade, skippedTest, suite } from './test.entry-point.ts';

type SkippedAuthoringExecution = {
    readonly plannedCase: TestPlan['discoveredCases'][number] | undefined;
    readonly result: Awaited<ReturnType<typeof execute>>;
    readonly testCase: TestCase;
    readonly testNode: Suite;
};

const invokeSkippedTest = skippedTest as (...parameters: readonly unknown[]) => unknown;

function assertSourceLocationInThisFile(scope: OverkillScope, location: SourceLocation): void {
    if (location.kind !== 'known') {
        scope.assert.equal(location.kind, 'known');

        return;
    }

    scope.assert.match(
        location.file.replaceAll('\\', '/'),
        /source\/packages\/test\/skipped-test-entry-point\.test\.[cm]?[jt]s$/u
    );
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

async function executeRootSkippedNode(): Promise<SkippedAuthoringExecution> {
    const testCase = skippedTest({
        metadata: { tags: [ 'case' ] },
        reason: ' unsupported platform ',
        title: 'skips'
    });
    const testNode = suite({
        children: [ testCase ],
        metadata: { extra: { suite: 'runtime' }, tags: [ 'suite' ] },
        title: 'runtime'
    });
    const plan = createTestPlan(createRoot({
        children: [ testNode ],
        metadata: { kind: 'microtest' },
        title: 'root'
    }));

    return {
        plannedCase: plan.discoveredCases[0],
        result: await execute(plan),
        testCase,
        testNode
    };
}

async function executeFacadeSkippedNode(): Promise<SkippedAuthoringExecution> {
    const integration = createTestFacade({
        metadata: { capture: 'buffered', extra: { layer: 'integration' }, tags: [ 'facade' ] },
        testFamily: 'integration'
    });
    const testCase = integration.skippedTest({
        metadata: { capture: 'live', extra: { case: 'skips' }, tags: [ 'case' ] },
        reason: 'external service unavailable',
        title: 'skips'
    });
    const testNode = integration.suite({
        children: [ testCase ],
        metadata: { capture: 'buffered', extra: { suite: 'runtime' }, tags: [ 'suite' ] },
        title: 'runtime'
    });
    const plan = createTestPlan(createRoot({
        children: [ testNode ],
        metadata: { kind: 'integration' },
        title: 'root'
    }));

    return {
        plannedCase: plan.discoveredCases[0],
        result: await execute(plan),
        testCase,
        testNode
    };
}

function assertSkippedOutcome(
    scope: OverkillScope,
    execution: SkippedAuthoringExecution,
    reason: string
): void {
    const outcome = execution.result.perTest[0]?.outcome;

    scope.require.defined(outcome);
    scope.assert.equal(outcome.kind, 'skip');

    if (outcome.kind === 'skip') {
        scope.assert.equal(outcome.reason, reason);
    }
}

function assertRootSkippedCase(scope: OverkillScope, execution: SkippedAuthoringExecution): void {
    scope.require.defined(execution.plannedCase);
    scope.assert.deepEqual(execution.plannedCase.id, {
        file: null,
        title: 'skips',
        params: null,
        suite: [ 'runtime' ]
    });
    scope.assert.deepEqual(execution.plannedCase.execution, { kind: 'skip', reason: 'unsupported platform' });
    scope.assert.equal(execution.plannedCase.metadata.kind, 'microtest');
    scope.assert.deepEqual(execution.plannedCase.metadata.tags, [ 'suite', 'case' ]);
    assertSkippedOutcome(scope, execution, 'unsupported platform');
}

function assertFacadeSkippedMetadata(scope: OverkillScope, execution: SkippedAuthoringExecution): void {
    scope.require.defined(execution.plannedCase);
    scope.assert.equal(execution.plannedCase.metadata.kind, 'integration');
    scope.assert.equal(execution.plannedCase.metadata.capture, 'live');
    scope.assert.deepEqual(execution.plannedCase.metadata.tags, [ 'facade', 'suite', 'case' ]);
    scope.assert.deepEqual(execution.plannedCase.metadata.extra, {
        case: 'skips',
        layer: 'integration',
        suite: 'runtime'
    });
}

function assertFacadeSkippedCase(scope: OverkillScope, execution: SkippedAuthoringExecution): void {
    scope.require.defined(execution.plannedCase);
    scope.assert.deepEqual(execution.plannedCase.id, {
        file: null,
        title: 'skips',
        params: null,
        suite: [ 'runtime' ]
    });
    scope.assert.deepEqual(execution.plannedCase.execution, {
        kind: 'skip',
        reason: 'external service unavailable'
    });
    assertFacadeSkippedMetadata(scope, execution);
    assertSkippedOutcome(scope, execution, 'external service unavailable');
    scope.assert.equal(execution.result.summary.skipped, 1);
    scope.assert.equal(execution.result.summary.failed, 0);
}

function assertSkippedSummary(scope: OverkillScope, summary: Awaited<ReturnType<typeof execute>>['summary']): void {
    scope.assert.deepEqual({
        ...summary,
        defined: null
    }, {
        crashed: 0,
        defined: null,
        discovered: 1,
        failed: 0,
        inconclusive: 0,
        passed: 0,
        planned: 1,
        resourceExhausted: 0,
        runtimePolicy: 0,
        skipped: 1
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/skipped-test-entry-point.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test skippedTest() creates visible skipped engine nodes',
            metadata: {},
            async body(scope: OverkillScope) {
                const execution = await executeRootSkippedNode();

                scope.assert.equal(ownsTestNode(execution.testCase), true);
                scope.assert.equal(ownsTestNode(execution.testNode), true);
                assertRootSkippedCase(scope, execution);
                assertDefinitionLocationInThisFile(scope, execution.testCase.definitionLocations);
                assertSkippedSummary(scope, execution.result.summary);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test facade skippedTest() composes family metadata',
            metadata: {},
            async body(scope: OverkillScope) {
                const execution = await executeFacadeSkippedNode();

                scope.assert.equal(ownsTestNode(execution.testCase), true);
                scope.assert.equal(ownsTestNode(execution.testNode), true);
                assertFacadeSkippedCase(scope, execution);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test skippedTest() delegates invalid inputs to engine validation',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function createSkippedTestWithWrongArity() {
                    invokeSkippedTest();
                }, { message: 'skippedTest() requires (title, reason) or ({ title, metadata, reason }).' });
                scope.assert.throws(function createSkippedTestWithoutStringReason() {
                    invokeSkippedTest('skips', 1);
                }, { message: 'skippedTest() requires (title, reason) or ({ title, metadata, reason }).' });
                scope.assert.throws(function createSkippedTestWithoutReason() {
                    skippedTest('skips', ' ');
                }, { message: 'Skipped test reason must not be empty.' });
                scope.assert.throws(function createSkippedMicrotestWithCapture() {
                    invokeSkippedTest({
                        metadata: { capture: 'live' },
                        reason: 'not supported',
                        title: 'captures'
                    });
                }, { message: 'Microtest authoring metadata does not support capture mode.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
