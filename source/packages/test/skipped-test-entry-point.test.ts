import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import {
    resolveSourceLocation,
    type SourceLocation,
    type Suite,
    type TestCase,
    type TestPlan,
    createRoot,
    createTestPlan,
    execute,
    ownsTestNode
} from '../engine/engine.entry-point.ts';

import { createTestFacade, skippedTest, suite as subjectSuite } from './test.entry-point.ts';

type SkippedAuthoringExecution = {
    readonly plannedCase: TestPlan['discoveredCases'][number] | undefined;
    readonly result: Awaited<ReturnType<typeof execute>>;
    readonly testCase: TestCase;
    readonly testNode: Suite;
};

const invokeSkippedTest = skippedTest as (...parameters: readonly unknown[]) => unknown;

const sourceLocationInThisFileChecks = (
    check: CompositeCheckBuilder<'assert'>,
    location: SourceLocation
): CompositeAssertionReturn<'assert'> => {
    if (location.kind !== 'known') {
        const initialChecks = check.equal(location.kind, 'known');
        return initialChecks;
    }
    return check.match(
        location.file.replaceAll('\\', '/'),
        /source\/packages\/test\/skipped-test-entry-point\.test\.[cm]?[jt]s$/u
    );
};

const assertDefinitionLocationInThisFile = defineCompositeAssertion({
    name: 'definition location in this file',
    assert(check, sourceLocations: TestCase['definitionLocations']) {
        const sourceLocation = sourceLocations[0];
        if (sourceLocation === undefined || sourceLocation === null) {
            return check.defined(sourceLocation);
        }
        const initialChecks = check.defined(sourceLocation);
        const resolvedLocation = resolveSourceLocation(sourceLocation);
        return check.group([
            initialChecks,
            sourceLocationInThisFileChecks(check.annotated('source location in this file'), resolvedLocation),
            check.equal(typeof resolvedLocation.line, 'number'),
            check.equal(typeof resolvedLocation.column, 'number')
        ]);
    }
});

async function executeRootSkippedNode(): Promise<SkippedAuthoringExecution> {
    const testCase = skippedTest({
        annotations: { tags: [ 'case' ] },
        reason: ' unsupported platform ',
        title: 'skips'
    });
    const testNode = subjectSuite({
        annotations: { tags: [ 'suite' ] },
        children: [ testCase ],
        controls: {},
        title: 'runtime'
    });
    const plan = createTestPlan(createRoot({
        annotations: {},
        children: [ testNode ],
        controls: {},
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
    const facade = createTestFacade({
        annotations: { tags: [ 'facade' ] },
        controls: { capture: 'buffered' }
    });
    const testCase = facade.skippedTest({
        annotations: { tags: [ 'case' ] },
        controls: { capture: 'live' },
        reason: 'external service unavailable',
        title: 'skips'
    });
    const testNode = facade.suite({
        annotations: { tags: [ 'suite' ] },
        children: [ testCase ],
        controls: { capture: 'buffered' },
        title: 'runtime'
    });
    const plan = createTestPlan(createRoot({
        annotations: {},
        children: [ testNode ],
        controls: {},
        title: 'root'
    }));

    return {
        plannedCase: plan.discoveredCases[0],
        result: await execute(plan),
        testCase,
        testNode
    };
}

const assertSkippedOutcome = defineCompositeAssertion({
    name: 'skipped outcome',
    assert(check, execution: SkippedAuthoringExecution, reason: string) {
        const outcome = execution.result.perTest[0]?.outcome;
        if (outcome === undefined || outcome === null) {
            return check.defined(outcome);
        }
        const initialChecksBeforeNextAction = check.group([
            check.defined(outcome),
            check.equal(outcome.kind, 'skip')
        ]);
        if (outcome.kind === 'skip') {
            return check.group([ initialChecksBeforeNextAction, check.equal(outcome.reason, reason) ]);
        } else {
            return initialChecksBeforeNextAction;
        }
    }
});

const assertFacadeSkippedData = defineCompositeAssertion({
    name: 'facade skipped data',
    assert(check, execution: SkippedAuthoringExecution) {
        if (execution.plannedCase === undefined || execution.plannedCase === null) {
            return check.defined(execution.plannedCase);
        }
        return check.group([
            check.equal(execution.plannedCase.testFamily, null),
            check.equal(execution.plannedCase.controls.capture, 'live'),
            check.deepEqual(execution.plannedCase.annotations.tags, [ 'facade', 'suite', 'case' ])
        ]);
    }
});

const assertSkippedSummary = defineCompositeAssertion({
    name: 'skipped summary',
    assert(check, summary: Awaited<ReturnType<typeof execute>>['summary']) {
        return check.group([ check.deepEqual({
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
            processExhausted: 0,
            runtimePolicy: 0,
            skipped: 1
        }) ]);
    }
});

export const testNode = suite('Skipped test entry point', [
    test(
        '@overkill-dev/test skippedTest() creates visible skipped engine nodes',
        async function (scope: TestScope) {
            const execution = await executeRootSkippedNode();

            scope.assert.equal(ownsTestNode(execution.testCase), true);
            scope.assert.equal(ownsTestNode(execution.testNode), true);

            scope.require.defined(execution.plannedCase);
            scope.assert.deepEqual(execution.plannedCase.id, {
                file: null,
                title: 'skips',
                params: null,
                suite: [ 'runtime' ]
            });
            scope.assert.deepEqual(execution.plannedCase.execution, { kind: 'skip', reason: 'unsupported platform' });
            scope.assert.equal(execution.plannedCase.testFamily, null);
            scope.assert.deepEqual(execution.plannedCase.annotations.tags, [ 'suite', 'case' ]);
            scope.assert(assertSkippedOutcome, execution, 'unsupported platform');

            scope.assert(assertDefinitionLocationInThisFile, execution.testCase.definitionLocations);
            scope.assert(assertSkippedSummary, execution.result.summary);

            return scope.assert.collect();
        }
    ),
    test('@overkill-dev/test facade skippedTest() composes family test data', async function (scope: TestScope) {
        const execution = await executeFacadeSkippedNode();

        scope.assert.equal(ownsTestNode(execution.testCase), true);
        scope.assert.equal(ownsTestNode(execution.testNode), true);

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
        scope.assert(assertFacadeSkippedData, execution);
        scope.assert(assertSkippedOutcome, execution, 'external service unavailable');
        scope.assert.equal(execution.result.summary.skipped, 1);
        scope.assert.equal(execution.result.summary.failed, 0);

        return scope.assert.collect();
    }),
    test(
        '@overkill-dev/test skippedTest() delegates invalid inputs to engine validation',
        function (scope) {
            scope.assert.throws(function createSkippedTestWithWrongArity() {
                invokeSkippedTest();
            }, {
                message: 'skippedTest() requires (title, reason) or ({ title, annotations?, controls?, reason }).'
            });
            scope.assert.throws(function createSkippedTestWithoutStringReason() {
                invokeSkippedTest('skips', 1);
            }, {
                message: 'skippedTest() requires (title, reason) or ({ title, annotations?, controls?, reason }).'
            });
            scope.assert.throws(function createSkippedTestWithoutReason() {
                skippedTest('skips', ' ');
            }, { message: 'Skipped test reason must not be empty.' });
            const captureCase = skippedTest({
                controls: { capture: 'live' },
                reason: 'not supported',
                title: 'captures'
            });

            scope.assert.deepEqual(captureCase.controls, { capture: 'live' });

            return scope.assert.collect();
        }
    )
]);
