import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { suite, test } from '@overkill-dev/test';

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

const sourceLocationInThisFileChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    location: SourceLocation
): CompositeAssertionReturn<'assert'> {
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
        return outcome.kind === 'skip'
            ? check.group([ initialChecksBeforeNextAction, check.equal(outcome.reason, reason) ])
            : initialChecksBeforeNextAction;
    }
});

const skippedNodeIdentity = defineCompositeAssertion({
    name: 'neutral skipped nodes retain identity and annotations',
    assert(check, execution: SkippedAuthoringExecution, reason: string, tags: readonly string[]) {
        const planned = execution.plannedCase;
        if (planned === undefined) {
            return check.defined(planned);
        }
        return check.group([
            check.true(ownsTestNode(execution.testCase)),
            check.true(ownsTestNode(execution.testNode)),
            check.deepEqual(planned.id, { file: null, title: 'skips', params: null, suite: [ 'runtime' ] }),
            check.deepEqual(planned.execution, { kind: 'skip', reason }),
            check.equal(planned.testFamily, null),
            check.deepEqual(planned.annotations.tags, tags)
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
        async function (scope) {
            const execution = await executeRootSkippedNode();

            scope.assert(skippedNodeIdentity, execution, 'unsupported platform', [ 'suite', 'case' ]);
            scope.assert(assertSkippedOutcome, execution, 'unsupported platform');

            scope.assert(assertDefinitionLocationInThisFile, execution.testCase.definitionLocations);
            scope.assert(assertSkippedSummary, execution.result.summary);

            return scope.assert.collect();
        }
    ),
    test('@overkill-dev/test facade skippedTest() composes family test data', async function (scope) {
        const execution = await executeFacadeSkippedNode();

        scope.assert(skippedNodeIdentity, execution, 'external service unavailable', [ 'facade', 'suite', 'case' ]);
        scope.assert.equal(execution.plannedCase?.controls.capture, 'live');
        scope.assert(assertSkippedOutcome, execution, 'external service unavailable');
        scope.assert(
            defineCompositeAssertion({
                name: '@overkill-dev/test facade skippedTest() composes family test data',
                assert(check) {
                    return check.group([
                        check.equal(execution.result.summary.skipped, 1),
                        check.equal(execution.result.summary.failed, 0)
                    ]);
                }
            })
        );

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
