import {
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    execute,
    ownsTestNode,
    type SourceLocation,
    type Suite,
    type TestBody,
    type TestCase,
    type TestPlan,
    type TestScope,
    type TestScope as OverkillScope
} from '../engine/engine.entry-point.ts';
import { createTestFacade } from './test.entry-point.ts';

type FacadeAuthoringExecution = {
    readonly plannedCase: TestPlan['discoveredCases'][number] | undefined;
    readonly result: Awaited<ReturnType<typeof execute>>;
    readonly testCase: TestCase;
    readonly testNode: Suite;
};

type NameData = {
    readonly name: string;
};

const invokeCreateTestFacade = createTestFacade as (...parameters: readonly unknown[]) => unknown;

function passingBody(scope: TestScope): ReturnType<TestBody> {
    scope.assert.true(true);
    return scope.assert.collect();
}

function checkParameterizedName(testScope: TestScope, data: NameData): ReturnType<TestBody> {
    testScope.assert.equal(data.name, 'Ada', { message: 'wrong name' });
    return testScope.assert.collect();
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

async function executeFacadeAuthoredNode(): Promise<FacadeAuthoringExecution> {
    const integration = createTestFacade({
        metadata: { capture: 'buffered', extra: { layer: 'integration' }, tags: [ 'facade' ] },
        testFamily: 'integration'
    });
    const testCase = integration.test({
        body: passingBody,
        metadata: { capture: 'buffered', extra: { case: 'passes' }, tags: [ 'case' ] },
        title: 'passes'
    });
    const testNode = integration.suite({
        children: [ testCase ],
        metadata: { capture: 'live', extra: { suite: 'runtime' }, tags: [ 'suite' ] },
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

async function executeAuthoredNode(testCase: TestCase): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(createTestPlan(createRoot({
        children: [ testCase ],
        metadata: {},
        title: 'root'
    })));
}

type FailOutcome = Extract<
    Awaited<ReturnType<typeof execute>>['perTest'][number]['outcome'],
    { readonly kind: 'fail'; }
>;

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

function assertSourceLocationInThisFile(scope: OverkillScope, location: SourceLocation): void {
    if (location.kind !== 'known') {
        scope.assert.equal(location.kind, 'known');

        return;
    }

    scope.assert.match(
        location.file.replaceAll('\\', '/'),
        /source\/packages\/test\/test-facade-entry-point\.test\.[cm]?[jt]s$/u
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

function assertFacadeAuthoredCase(scope: OverkillScope, plannedCase: FacadeAuthoringExecution['plannedCase']): void {
    scope.require.defined(plannedCase);
    scope.assert.deepEqual(plannedCase.id, {
        file: null,
        title: 'passes',
        params: null,
        suite: [ 'runtime' ]
    });
    scope.assert.equal(plannedCase.metadata.kind, 'integration');
    scope.assert.equal(plannedCase.metadata.capture, 'buffered');
    scope.assert.deepEqual(plannedCase.metadata.tags, [ 'facade', 'suite', 'case' ]);
    scope.assert.deepEqual(plannedCase.metadata.extra, {
        case: 'passes',
        layer: 'integration',
        suite: 'runtime'
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/test-facade-entry-point.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test createTestFacade() returns a narrow authoring surface',
            metadata: {},
            body(scope: OverkillScope) {
                const facade = createTestFacade({ testFamily: 'microtest' });

                scope.assert.deepEqual(Object.keys(facade), [
                    'defineMacro',
                    'defineParameterizedTestBody',
                    'runIfMain',
                    'suite',
                    'table',
                    'test'
                ]);
                scope.assert.equal(Object.hasOwn(facade, 'doubleUsage'), false);
                scope.assert.equal(Object.hasOwn(facade, 'testDouble'), false);
                scope.assert.equal(Object.hasOwn(facade, 'defineCompositeAssertion'), false);
                scope.assert.throws(function createFacadeWithoutDefinition() {
                    invokeCreateTestFacade();
                }, { message: 'createTestFacade() requires ({ testFamily, metadata? }).' });
                scope.assert.throws(function createMicrotestFacadeWithCapture() {
                    invokeCreateTestFacade({
                        metadata: { capture: 'live' },
                        testFamily: 'microtest'
                    });
                }, { message: 'Microtest authoring metadata does not support capture mode.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test createTestFacade() composes family-specific authoring helpers',
            metadata: {},
            async body(scope: OverkillScope) {
                const execution = await executeFacadeAuthoredNode();

                scope.assert.equal(ownsTestNode(execution.testCase), true);
                scope.assert.equal(ownsTestNode(execution.testNode), true);
                assertFacadeAuthoredCase(scope, execution.plannedCase);
                assertPassingSummary(scope, execution.result.summary);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test facade helpers forward definition and assertion source locations',
            metadata: {},
            async body(scope: OverkillScope) {
                const facade = createTestFacade({ testFamily: 'microtest' });
                const checkMissingName = facade.defineMacro(function createFacadeMissingNameTest(title: string) {
                    return facade.test(title, function checkName(testScope) {
                        testScope.assert.equal('', 'Ada', { message: 'missing name' });
                        return testScope.assert.collect();
                    });
                });
                const checkName = facade.defineParameterizedTestBody(checkParameterizedName);
                const macroCase = checkMissingName('requires name');
                const parameterizedCase = facade.test('checks name', checkName({ name: 'Grace' }));
                const macroResult = await executeAuthoredNode(macroCase);
                const parameterizedResult = await executeAuthoredNode(parameterizedCase);

                assertMacroLocationForwarding(scope, macroCase, firstFailedCheckSourceLocations(macroResult));
                assertParameterizedBodyLocationForwarding(
                    scope,
                    parameterizedCase,
                    firstFailedCheckSourceLocations(parameterizedResult)
                );

                return scope.assert.collect();
            }
        })
    ]
});
