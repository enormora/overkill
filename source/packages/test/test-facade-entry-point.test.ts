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
    type TestNode,
    type TestPlan,
    type TestScope,
    type TestScope as OverkillScope
} from '../engine/engine.entry-point.ts';
import {
    createTestFacade,
    type TestFacade
} from './test.entry-point.ts';
import * as resourcesSubpath from './resources.entry-point.ts';

type FacadeAuthoringExecution = {
    readonly plannedCase: TestPlan['discoveredCases'][number] | undefined;
    readonly result: Awaited<ReturnType<typeof execute>>;
    readonly testCase: TestCase;
    readonly testNode: Suite;
};

type NameData = {
    readonly name: string;
};

type Database = {
    readonly url: string;
};
type EmptyResourceDependencies = Readonly<Record<PropertyKey, never>>;

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
    const facade = createTestFacade({
        annotations: { tags: [ 'facade' ] },
        controls: { capture: 'buffered' }
    });
    const testCase = facade.test({
        annotations: { tags: [ 'case' ] },
        body: passingBody,
        controls: { capture: 'buffered' },
        title: 'passes'
    });
    const testNode = facade.suite({
        annotations: { tags: [ 'suite' ] },
        children: [ testCase ],
        controls: { capture: 'live' },
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

async function executeAuthoredNode(testCase: TestCase): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(createTestPlan(createRoot({
        children: [ testCase ],
        annotations: {},
        controls: {},
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
    scope.assert.equal(plannedCase.controls.capture, 'buffered');
    scope.assert.deepEqual(plannedCase.annotations.tags, [ 'facade', 'suite', 'case' ]);
    scope.assert.equal(plannedCase.testFamily, null);
}

function assertNarrowFacadeSurface(scope: OverkillScope, facade: TestFacade): void {
    scope.assert.deepEqual(Object.keys(facade), [
        'defineMacro',
        'defineParameterizedTestBody',
        'runIfMain',
        'skippedTest',
        'suite',
        'table',
        'test'
    ]);
    scope.assert.equal(Object.hasOwn(facade, 'doubleUsage'), false);
    scope.assert.equal(Object.hasOwn(facade, 'testDouble'), false);
    scope.assert.equal(Object.hasOwn(facade, 'defineHarness'), false);
    scope.assert.equal(Object.hasOwn(facade, 'defineCompositeAssertion'), false);
}

async function executeFacadeNode(testNode: TestNode): Promise<{
    readonly plan: TestPlan;
    readonly result: Awaited<ReturnType<typeof execute>>;
}> {
    const plan = createTestPlan(createRoot({
        annotations: {},
        children: [ testNode ],
        controls: {},
        title: 'root'
    }));

    return {
        plan,
        result: await execute(plan)
    };
}

function countedDatabaseResource(
    recordAcquisition: () => void
): resourcesSubpath.ResourceDefinition<'database', Database, EmptyResourceDependencies> {
    return resourcesSubpath.defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(): Database {
            recordAcquisition();

            return { url: 'postgres://localhost' };
        },
        dispose: null
    });
}

async function executeFacadeRuntimeBinding(): Promise<{
    readonly acquisitions: number;
    readonly execution: Awaited<ReturnType<typeof executeFacadeNode>>;
}> {
    let acquisitions = 0;
    const database = countedDatabaseResource(function recordAcquisition(): void {
        acquisitions += 1;
    });
    const runtime = resourcesSubpath.defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database },
        requirements: []
    });
    const facade = createTestFacade({
        runtime,
        resources: { store: database },
        mapScope(facadeScope) {
            return {
                databaseUrl: facadeScope.runtimes.api.database.url,
                sharedHandle: facadeScope.runtimes.api.database === facadeScope.resources.store
            };
        }
    });
    const testCase = facade.test('uses facade runtime', function runFacadeRuntime(facadeScope) {
        facadeScope.assert.equal(facadeScope.databaseUrl, 'postgres://localhost');
        facadeScope.assert.equal(facadeScope.resources.store.url, 'postgres://localhost');
        facadeScope.assert.equal(facadeScope.sharedHandle, true);

        return facadeScope.assert.collect();
    });

    const execution = await executeFacadeNode(testCase);

    return { acquisitions, execution };
}

function assertFacadeRuntimePlan(scope: OverkillScope, plan: TestPlan): void {
    const plannedCase = plan.discoveredCases[0];

    scope.require.defined(plannedCase);
    scope.assert.equal(plannedCase.testFamily, null);
    scope.assert.deepEqual(plannedCase.resourceAttachments.directResources, [
        { key: 'store', resourceName: 'database' }
    ]);
    scope.assert.deepEqual(
        plannedCase.resourceAttachments.runtimeGraphs.map(function runtimeName(graph) {
            return graph.name;
        }),
        [ 'api' ]
    );
    scope.assert.deepEqual(
        plannedCase.resourceAttachments.resourceGraph.map(function resourceName(resource) {
            return resource.name;
        }),
        [ 'database' ]
    );
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/test-facade-entry-point.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test createTestFacade() returns a narrow authoring surface',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const facade = createTestFacade();

                assertNarrowFacadeSurface(scope, facade);
                scope.assert.throws(function createUnknownFacade() {
                    invokeCreateTestFacade({ unknown: true });
                }, {
                    message:
                        'createTestFacade() requires no arguments or ({ annotations?, controls?, runtime?, resources?, mapScope? }).'
                });
                scope.assert.throws(function createFamilyFacade() {
                    invokeCreateTestFacade({ testFamily: 'microtest' });
                }, {
                    message:
                        'createTestFacade() requires no arguments or ({ annotations?, controls?, runtime?, resources?, mapScope? }).'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test createTestFacade() composes neutral authoring helpers',
            annotations: {},
            controls: {},
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
            title: '@overkill-dev/test createTestFacade() binds facade runtime resources and scope mapping',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const { acquisitions, execution } = await executeFacadeRuntimeBinding();

                assertFacadeRuntimePlan(scope, execution.plan);
                assertPassingSummary(scope, execution.result.summary);
                scope.assert.equal(acquisitions, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test createTestFacade() rejects duplicate facade and body resource scopes',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const database = countedDatabaseResource(function recordAcquisition(): void {
                    return undefined;
                });
                const runtime = resourcesSubpath.defineRuntime({
                    name: 'api',
                    dimensions: {},
                    resources: { database },
                    requirements: []
                });
                const duplicateRuntime = resourcesSubpath.defineRuntime({
                    name: 'api',
                    dimensions: {},
                    resources: {},
                    requirements: []
                });
                const resourceFacade = createTestFacade({
                    resources: { store: database }
                });
                const runtimeFacade = createTestFacade({ runtime });

                scope.assert.throws(function createDuplicateResourceCase() {
                    resourceFacade.test(
                        'duplicates store',
                        resourcesSubpath.withResources({ store: database }, passingBody)
                    );
                }, { message: 'Resource scope "store" is attached multiple times.' });
                scope.assert.throws(function createDuplicateRuntimeCase() {
                    runtimeFacade.test(
                        'duplicates api',
                        resourcesSubpath.withRuntime(duplicateRuntime, passingBody)
                    );
                }, { message: 'Runtime scope "api" is attached multiple times.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test createTestFacade() maps table scope before row parameters and body resources',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const database = countedDatabaseResource(function recordAcquisition(): void {
                    return undefined;
                });
                const facade = createTestFacade({
                    resources: { store: database },
                    mapScope(facadeScope) {
                        return {
                            databaseUrl: facadeScope.resources.store.url,
                            parameters: { value: 0 }
                        };
                    }
                });
                const table = facade.table({
                    cases: [ { value: 1 }, { value: 2 } ],
                    test(facadeScope) {
                        facadeScope.assert.equal(facadeScope.databaseUrl, 'postgres://localhost');
                        facadeScope.assert.true(facadeScope.parameters.value > 0);

                        return facadeScope.assert.collect();
                    },
                    title: 'rows'
                });
                const execution = await executeFacadeNode(table);

                scope.assert.equal(execution.result.summary.passed, 2);
                scope.assert.equal(execution.result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test facade helpers forward definition and assertion source locations',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const facade = createTestFacade();
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
