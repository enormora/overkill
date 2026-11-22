import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { suite, test, type TestScope } from '@overkill-dev/test';
import type { EngineCaseBody } from '../../../../test-support/create-test-engine.ts';

import {
    resolveSourceLocation,
    type SourceLocation,
    type Suite,
    type TestCase,
    type TestNode as SubjectTestNode,
    type TestPlan,
    createRoot,
    createTestPlan,
    execute,
    ownsTestNode
} from '../../../../packages/engine/engine.entry-point.ts';

import { createTestFacade, type TestFacade } from '../../../../packages/test/test.entry-point.ts';
import * as resourcesSubpath from '../../../../packages/test/resources.entry-point.ts';

type CheckParameterizedNameAssertions = { readonly assert: Pick<TestScope['assert'], 'collect' | 'equal'>; };

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

const passingBody: EngineCaseBody = function (scope) {
    scope.assert.true(true);
    return scope.assert.collect();
};

function checkParameterizedName(
    testScope: CheckParameterizedNameAssertions,
    data: NameData
): ReturnType<EngineCaseBody> {
    testScope.assert.equal(data.name, 'Ada', { message: 'wrong name' });
    return testScope.assert.collect();
}

const assertPassingSummary = defineCompositeAssertion({
    name: 'passing summary',
    assert(check, summary: unknown) {
        return check.group([ check.deepEqual({
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
            processExhausted: 0,
            runtimePolicy: 0,
            skipped: 0
        }) ]);
    }
});

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
        /source\/integration-tests\/runtime\/packages\/test\/test-facade-entry-point\.test\.[cm]?[jt]s$/u
    );
};

const firstSourceLocationInThisFileChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    sourceLocations: readonly SourceLocation[]
): CompositeAssertionReturn<'assert'> {
    const sourceLocation = sourceLocations[0];
    if (sourceLocation === undefined) {
        return check.defined(sourceLocation);
    }
    return check.group([
        check.defined(sourceLocation),
        sourceLocationInThisFileChecks(check.annotated('source location in this file'), sourceLocation)
    ]);
};

const assertMacroLocationForwarding = defineCompositeAssertion({
    name: 'macro location forwarding',
    assert(check, testCase: TestCase, failedSourceLocations: readonly SourceLocation[]) {
        const macroDefinitionLocation = testCase.definitionLocations[0];

        return check.group([
            check.defined(macroDefinitionLocation),
            check.equal(testCase.definitionLocations.length, 2),
            check.equal(failedSourceLocations.length, 2),
            sourceLocationInThisFileChecks(
                check.annotated('source location in this file'),
                resolveSourceLocation(macroDefinitionLocation)
            ),
            firstSourceLocationInThisFileChecks(
                check.annotated('first source location in this file'),
                failedSourceLocations
            )
        ]);
    }
});

const assertParameterizedBodyLocationForwarding = defineCompositeAssertion({
    name: 'parameterized body location forwarding',
    assert(check, testCase: TestCase, failedSourceLocations: readonly SourceLocation[]) {
        return check.group([
            check.equal(testCase.definitionLocations.length, 1),
            check.equal(failedSourceLocations.length, 2),
            firstSourceLocationInThisFileChecks(
                check.annotated('first source location in this file'),
                failedSourceLocations
            )
        ]);
    }
});

const assertFacadeAuthoredCase = defineCompositeAssertion({
    name: 'facade authored case',
    assert(check, plannedCase: FacadeAuthoringExecution['plannedCase']) {
        if (plannedCase === undefined) {
            return check.defined(plannedCase);
        }
        return check.group([
            check.deepEqual(plannedCase.id, {
                file: null,
                title: 'passes',
                params: null,
                suite: [ 'runtime' ]
            }),
            check.equal(plannedCase.controls.capture, 'buffered'),
            check.deepEqual(plannedCase.annotations.tags, [ 'facade', 'suite', 'case' ]),
            check.equal(plannedCase.testFamily, null)
        ]);
    }
});

const assertNarrowFacadeSurface = defineCompositeAssertion({
    name: 'narrow facade surface',
    assert(check, facade: TestFacade) {
        return check.group([
            check.deepEqual(Object.keys(facade), [
                'defineMacro',
                'defineParameterizedTestBody',
                'runIfMain',
                'skippedTest',
                'suite',
                'table',
                'test'
            ]),
            check.equal(Object.hasOwn(facade, 'doubleUsage'), false),
            check.equal(Object.hasOwn(facade, 'testDouble'), false),
            check.equal(Object.hasOwn(facade, 'defineHarness'), false),
            check.equal(Object.hasOwn(facade, 'defineCompositeAssertion'), false)
        ]);
    }
});

async function executeFacadeNode(testNode: SubjectTestNode): Promise<{
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
        facadeScope.assert.equal(facadeScope.sharedHandle, false);

        return facadeScope.assert.collect();
    });

    const execution = await executeFacadeNode(testCase);

    return { acquisitions, execution };
}

async function executeFacadeScopeMappingCollision(key: string): Promise<Awaited<ReturnType<typeof execute>>> {
    const facade = createTestFacade({
        mapScope() {
            return { [key]: true };
        }
    });
    const testCase = facade.test('collides', passingBody);

    return await executeAuthoredNode(testCase);
}

const assertFacadeRuntimePlan = defineCompositeAssertion({
    name: 'facade runtime plan',
    assert(check, plan: TestPlan) {
        const plannedCase = plan.discoveredCases[0];

        return check.group([
            check.equal(plannedCase.testFamily, null),
            check.deepEqual(plannedCase.resourceAttachments.directResources, [
                { key: 'store', resourceName: 'database' }
            ]),
            check.deepEqual(
                plannedCase.resourceAttachments.runtimeGraphs.map(function runtimeName(graph) {
                    return graph.name;
                }),
                [ 'api' ]
            ),
            check.deepEqual(
                plannedCase.resourceAttachments.resourceGraph.map(function resourceName(resource) {
                    return resource.name;
                }),
                [ 'database' ]
            )
        ]);
    }
});

const assertFacadeScopeMappingCollision = defineCompositeAssertion({
    name: 'facade scope mapping collision',
    assert(check, result: Awaited<ReturnType<typeof execute>>, key: string) {
        const failure = firstFailedOutcome(result).failures[0];
        if (failure.kind !== 'body-error') {
            const initialChecks = check.equal(failure.kind, 'body-error');
            return initialChecks;
        }
        return check.equal(
            failure.error.message,
            `createTestFacade() mapScope must not return reserved scope key "${key}".`
        );
    }
});

export const testNode = suite('Test facade authoring', [
    test('returns a narrow authoring surface', function (scope) {
        const facade = createTestFacade();

        scope.assert(assertNarrowFacadeSurface, facade);
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
    }),
    test(
        'composes neutral authoring helpers',
        async function (scope) {
            const execution = await executeFacadeAuthoredNode();

            scope.assert.equal(ownsTestNode(execution.testCase), true);
            scope.assert.equal(ownsTestNode(execution.testNode), true);
            scope.assert(assertFacadeAuthoredCase, execution.plannedCase);
            scope.assert(assertPassingSummary, execution.result.summary);

            return scope.assert.collect();
        }
    ),
    test(
        'binds facade runtime resources and scope mapping',
        async function (scope) {
            const { acquisitions, execution } = await executeFacadeRuntimeBinding();

            scope.assert(assertFacadeRuntimePlan, execution.plan);
            scope.assert(assertPassingSummary, execution.result.summary);
            scope.assert.equal(acquisitions, 2);

            return scope.assert.collect();
        }
    ),
    test(
        'rejects reserved scope keys from dynamic mappings',
        async function (scope) {
            for (const key of [ 'assert', 'resources', 'parameters' ]) {
                scope.assert(assertFacadeScopeMappingCollision, await executeFacadeScopeMappingCollision(key), key);
            }

            return scope.assert.collect();
        }
    ),
    test(
        'rejects duplicate facade and body resource scopes',
        function (scope) {
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
    ),
    test(
        'maps table scope before row parameters and body resources',
        async function (scope) {
            const database = countedDatabaseResource(function recordAcquisition(): void {
                return undefined;
            });
            const facade = createTestFacade({
                resources: { store: database },
                mapScope(facadeScope) {
                    return {
                        databaseUrl: facadeScope.resources.store.url,
                        mappedParameters: { value: 0 }
                    };
                }
            });
            const table = facade.table({
                cases: [ { value: 1 }, { value: 2 } ],
                test(facadeScope) {
                    facadeScope.assert.equal(facadeScope.databaseUrl, 'postgres://localhost');
                    facadeScope.assert.equal(facadeScope.mappedParameters.value, 0);
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
    ),
    test(
        '@overkill-dev/test facade helpers forward definition and assertion source locations',
        async function (scope) {
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

            scope.assert(assertMacroLocationForwarding, macroCase, firstFailedCheckSourceLocations(macroResult));
            scope.assert(
                assertParameterizedBodyLocationForwarding,
                parameterizedCase,
                firstFailedCheckSourceLocations(parameterizedResult)
            );

            return scope.assert.collect();
        }
    )
]);
