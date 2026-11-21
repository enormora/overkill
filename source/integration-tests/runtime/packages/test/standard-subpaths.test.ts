import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { engineCasePassedChecks } from '../../../../test-support/create-test-engine.ts';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, executeEngineCase } from '../../../../test-support/create-test-engine.ts';

import {
    readTestBodyResourceAttachments,
    type RootOptions,
    type TestBodyResourceSummary,
    type TestPlan,
    createRoot,
    createTestPlan
} from '../../../../packages/engine/engine.entry-point.ts';

import { createReportingContext } from '../../../../engine/reporting-context.ts';
import * as assertSubpath from '../../../../packages/test/assert.entry-point.ts';
import * as configSubpath from '../../../../packages/test/config.entry-point.ts';
import * as reportersSubpath from '../../../../packages/test/reporters.entry-point.ts';
import * as resourcesSubpath from '../../../../packages/test/resources.entry-point.ts';
import {
    createTestFacade,
    defineMacro as defineSubjectMacro,
    table,
    test as subjectTest
} from '../../../../packages/test/test.entry-point.ts';

const invokeWithResource = resourcesSubpath.withResource as (...parameters: readonly unknown[]) => unknown;
const invokeWithResources = resourcesSubpath.withResources as (...parameters: readonly unknown[]) => unknown;
const invokeWithRuntime = resourcesSubpath.withRuntime as (...parameters: readonly unknown[]) => unknown;

type BoundaryRow = {
    readonly value: number;
};
type NamedResourceDescriptor = {
    readonly name: string;
};
type NamedRuntimeDescriptor = resourcesSubpath.RuntimeDefinition;
type CycleDependencies = {
    readonly self: resourcesSubpath.ResourceDefinition<'cycle', string, CycleDependencies>;
};
type RuntimeRowInput = Parameters<EngineCaseBody>[0] & { readonly parameters: BoundaryRow; };

type ResourceWrapperBehavior = {
    readonly body: resourcesSubpath.RuntimeWrappedTestBody;
    readonly database: NamedResourceDescriptor;
    readonly resourceBody: resourcesSubpath.ResourceWrappedTestBody;
    readonly runtime: resourcesSubpath.RuntimeDefinition;
    readonly tableBody: resourcesSubpath.RuntimeWrappedTestBody<
        resourcesSubpath.RuntimeGraph,
        RuntimeRowInput
    >;
    readonly temporaryDirectory: NamedResourceDescriptor;
};

function sortedKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
    return Object.keys(value).toSorted(function compareExportNames(left, right) {
        return left.localeCompare(right);
    });
}

const assertConfigSubpath = defineCompositeAssertion({
    name: 'config subpath',
    assert(check) {
        const config = {
            profiles: {
                unit: {
                    files: {
                        include: [ 'source/**/*.test.ts' ]
                    },
                    testFamily: 'microtest'
                }
            }
        } as const;
        return check.group([
            check.deepEqual(sortedKeys(configSubpath), [
                'ConfigError',
                'defineBaselineAdapter',
                'defineConfig',
                'loadConfig',
                'normalizeConfig'
            ]),
            check.equal(configSubpath.defineConfig(config), config),
            check.equal(Object.hasOwn(configSubpath, 'orchestrator'), false),
            check.equal(typeof configSubpath.loadConfig, 'function'),
            check.equal(configSubpath.normalizeConfig(config).profiles.unit?.testFamily, 'microtest')
        ]);
    }
});

function reporterSubpathOutputs(): readonly string[] {
    const context = createReportingContext({ projectRoot: null });
    const line = reportersSubpath.createLineReporter()(context);
    const brief = reportersSubpath.createBriefReporter()(context);
    const briefFinal = reportersSubpath.createBriefFinalResultReporter()(context);
    const dot = reportersSubpath.createDotReporter()(context);
    const progress = reportersSubpath.createLineProgressReporter()(context);
    const tree = reportersSubpath.createLineTreeReporter()(context);
    const githubActions = reportersSubpath.createGithubActionsOutputRenderer()(context);

    return [
        line.name,
        brief.name,
        briefFinal.name,
        dot.name,
        progress.name,
        tree.name,
        githubActions.render({
            annotation: null,
            kind: 'stdout-line',
            role: 'primary',
            text: 'hello'
        })
    ];
}

const assertAssertSubpath = defineCompositeAssertion({
    name: 'assert subpath',
    assert(check) {
        return check.group([
            check.deepEqual(sortedKeys(assertSubpath), [
                'defineCompositeAssertion',
                'defineNarrowingCompositeAssertion'
            ]),
            check.equal(typeof assertSubpath.defineCompositeAssertion, 'function')
        ]);
    }
});

const resourcesSubpathExportsChecks = (check: CompositeCheckBuilder<'assert'>): CompositeAssertionReturn<'assert'> => {
    return check.group([
        check.deepEqual(sortedKeys(resourcesSubpath), [
            'composeRuntimeContext',
            'composeRuntimes',
            'createLocalHttpServiceResource',
            'createLocalProcessServiceResource',
            'createSimulatedHttpServerResource',
            'createTemporaryDirectoryResource',
            'defineImplementationReference',
            'defineLocalServiceResource',
            'defineResource',
            'defineResourceCheckObserverReference',
            'defineResourceConsumerReference',
            'defineResourceOwnerReference',
            'defineResourceReference',
            'defineRuntime',
            'defineRuntimeMatrix',
            'ResourceLifecycleError',
            'startRuntime',
            'withFailureArtifacts',
            'withResource',
            'withResourceChecks',
            'withResources',
            'withRuntime',
            'withWitnessReplay'
        ]),
        check.equal(typeof resourcesSubpath.startRuntime, 'function')
    ]);
};

function testPlanForChildren(children: RootOptions['children']): TestPlan {
    return createTestPlan(createRoot({
        annotations: {},
        children,
        controls: {},
        title: 'root'
    }));
}

const integrationRuntimeAuthoringChecks = (
    check: CompositeCheckBuilder<'assert'>,
    body: resourcesSubpath.RuntimeWrappedTestBody,
    tableBody: resourcesSubpath.RuntimeWrappedTestBody<
        resourcesSubpath.RuntimeGraph,
        RuntimeRowInput
    >
): CompositeAssertionReturn<'assert'> => {
    const facade = createTestFacade();
    const runtimeTable = facade.table({
        cases: [ { value: 1 }, { value: 2 } ],
        test: tableBody,
        title: 'rows'
    });
    return check.group([
        check.equal(facade.test('uses database', body).kind, 'test'),
        check.equal(runtimeTable.kind, 'table')
    ]);
};

const microtestCaseRuntimeMetadataChecks = (
    check: CompositeCheckBuilder<'assert'>,
    body: resourcesSubpath.RuntimeWrappedTestBody
): CompositeAssertionReturn<'assert'> => {
    const microtestCase = subjectTest('uses database', body);
    const microtestCasePlan = testPlanForChildren([ microtestCase ]);
    const plannedCase = microtestCasePlan.discoveredCases[0];
    if (plannedCase === undefined || plannedCase === null) {
        return check.defined(plannedCase);
    }
    return check.group([ check.deepEqual(plannedCase.resourceAttachments, readTestBodyResourceAttachments(body)) ]);
};

const microtestTableRuntimeMetadataChecks = (
    check: CompositeCheckBuilder<'assert'>,
    tableBody: resourcesSubpath.RuntimeWrappedTestBody<
        resourcesSubpath.RuntimeGraph,
        RuntimeRowInput
    >
): CompositeAssertionReturn<'assert'> => {
    const microtestTable = table({
        cases: [ { value: 1 }, { value: 2 } ],
        test: tableBody,
        title: 'rows'
    });
    const microtestTablePlan = testPlanForChildren([ microtestTable ]);
    const firstTableCase = microtestTablePlan.discoveredCases[0];
    const secondTableCase = microtestTablePlan.discoveredCases[1];
    if (firstTableCase === undefined || firstTableCase === null) {
        return check.defined(firstTableCase);
    }
    if (secondTableCase === undefined || secondTableCase === null) {
        return check.defined(secondTableCase);
    }
    return check.group([
        check.deepEqual(firstTableCase.resourceAttachments, readTestBodyResourceAttachments(tableBody)),
        check.deepEqual(secondTableCase.resourceAttachments, readTestBodyResourceAttachments(tableBody))
    ]);
};

const runtimeAuthoringMetadataChecks = (
    check: CompositeCheckBuilder<'assert'>,
    body: resourcesSubpath.RuntimeWrappedTestBody,
    tableBody: resourcesSubpath.RuntimeWrappedTestBody<
        resourcesSubpath.RuntimeGraph,
        RuntimeRowInput
    >
): CompositeAssertionReturn<'assert'> => {
    return check.group([
        integrationRuntimeAuthoringChecks(check.annotated('integration runtime authoring'), body, tableBody),
        microtestCaseRuntimeMetadataChecks(check.annotated('microtest case runtime metadata'), body),
        microtestTableRuntimeMetadataChecks(check.annotated('microtest table runtime metadata'), tableBody)
    ]);
};

const macroRuntimeMetadataChecks = (
    check: CompositeCheckBuilder<'assert'>,
    runtime: resourcesSubpath.RuntimeGraph
): CompositeAssertionReturn<'assert'> => {
    const runtimeMacro = defineSubjectMacro(function createRuntimeCase(title: string) {
        return subjectTest(
            title,
            resourcesSubpath.withRuntime(runtime, function runWithRuntime(runtimeScope) {
                return runtimeScope.assert.collect();
            })
        );
    });
    const testCase = runtimeMacro('uses runtime');
    const plannedCase = testPlanForChildren([ testCase ]).discoveredCases[0];
    if (plannedCase === undefined || plannedCase === null) {
        return check.defined(plannedCase);
    }
    const runtimeGraph = plannedCase.resourceAttachments.runtimeGraphs[0];
    if (runtimeGraph === undefined || runtimeGraph === null) {
        return check.defined(runtimeGraph);
    }
    return check.group([
        check.deepEqual(runtimeGraph.resources, [ { key: 'database', resourceName: 'database' } ]),
        check.deepEqual(
            plannedCase.resourceAttachments.resourceGraph.map(function toName(resource) {
                return resource.name;
            }),
            [ 'database' ]
        )
    ]);
};

const resourceDescriptorsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    database: NamedResourceDescriptor,
    runtime: NamedRuntimeDescriptor,
    temporaryDirectory: NamedResourceDescriptor
): CompositeAssertionReturn<'assert'> => {
    return check.group([
        check.equal(database.name, 'database'),
        check.equal(runtime.id.name, 'api'),
        check.deepEqual(Object.keys(runtime.resources), [ 'database' ]),
        check.equal(temporaryDirectory.name, 'scratch')
    ]);
};

function expectedLocalResource(
    name: string,
    requirements: readonly Readonly<Record<string, unknown>>[]
): TestBodyResourceSummary {
    return {
        workload: 'independent' as const,
        dependencies: [],
        handleTransport: 'local',
        name,
        requirements,
        scenarios: [],
        scope: 'per-case'
    };
}

const runtimeAttachmentsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    body: resourcesSubpath.RuntimeWrappedTestBody
): CompositeAssertionReturn<'assert'> => {
    return check.group([ check.deepEqual(readTestBodyResourceAttachments(body), {
        directResources: [],
        resourceGraph: [
            expectedLocalResource('database', [ { kind: 'exclusive-resource', name: 'database' } ])
        ],
        runtimeGraphs: [
            {
                dimensions: {},
                kind: 'runtime',
                name: 'api',
                requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ],
                scenarioBindings: [],
                resources: [ { key: 'database', resourceName: 'database' } ]
            }
        ]
    }) ]);
};

const directResourceAttachmentsChecks = (
    check: CompositeCheckBuilder<'assert'>,
    body: resourcesSubpath.ResourceWrappedTestBody
): CompositeAssertionReturn<'assert'> => {
    return check.group([ check.deepEqual(readTestBodyResourceAttachments(body), {
        directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
        resourceGraph: [ expectedLocalResource('scratch', []) ],
        runtimeGraphs: []
    }) ]);
};

function cyclicResource(): resourcesSubpath.ResourceDefinition<'cycle', string, CycleDependencies> {
    const resource: resourcesSubpath.ResourceDefinition<'cycle', string, CycleDependencies> = resourcesSubpath
        .defineResource({
            name: 'cycle',
            scope: 'per-case',
            requirements: [],
            dependencies: {
                get self(): resourcesSubpath.ResourceDefinition<'cycle', string, CycleDependencies> {
                    return resource;
                }
            },
            acquire() {
                return 'cycle';
            },
            dispose: null
        });

    return resource;
}

const assertResourceWrapperValidation = defineCompositeAssertion({
    name: 'resource wrapper validation',
    assert(
        check,
        database: resourcesSubpath.AnyResourceDefinition,
        runtime: resourcesSubpath.RuntimeGraph,
        temporaryDirectory: resourcesSubpath.AnyResourceDefinition
    ) {
        const body = function resourceBody(): EngineCaseBody {
            return function runResourceValidation(resourceScope) {
                return resourceScope.assert.collect();
            };
        };
        return check.group([
            check.throws(function rejectInvalidResource() {
                invokeWithResource({ name: 'invalid' }, body());
            }, { message: 'withResource() requires resource descriptors.' }),
            check.throws(function rejectInvalidRuntime() {
                invokeWithRuntime({ name: 'invalid' }, body());
            }, { message: 'withRuntime() requires a runtime descriptor.' }),
            check.throws(function rejectEmptyResources() {
                invokeWithResources({}, body());
            }, { message: 'withResources() requires at least one resource descriptor.' }),
            check.deepEqual(
                readTestBodyResourceAttachments(resourcesSubpath.withResource(
                    temporaryDirectory,
                    resourcesSubpath.withRuntime(runtime, body())
                )),
                {
                    directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
                    resourceGraph: [
                        expectedLocalResource('scratch', []),
                        expectedLocalResource('database', [ { kind: 'exclusive-resource', name: 'database' } ])
                    ],
                    runtimeGraphs: [
                        {
                            dimensions: {},
                            kind: 'runtime',
                            name: 'api',
                            requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ],
                            scenarioBindings: [],
                            resources: [ { key: 'database', resourceName: 'database' } ]
                        }
                    ]
                }
            ),
            check.throws(function rejectDuplicateDirectResourceKey() {
                resourcesSubpath.withResource(
                    temporaryDirectory,
                    resourcesSubpath.withResource(temporaryDirectory, body())
                );
            }, { message: 'Resource scope "scratch" is attached multiple times.' }),
            check.throws(function rejectDuplicateRuntimeKey() {
                resourcesSubpath.withRuntime(runtime, resourcesSubpath.withRuntime(runtime, body()));
            }, { message: 'Runtime scope "api" is attached multiple times.' }),
            check.throws(function rejectDuplicateNames() {
                const duplicateDatabase = resourcesSubpath.defineResource({
                    name: 'database',
                    scope: 'per-case',
                    requirements: [],
                    acquire() {
                        return { url: 'postgres://duplicate' };
                    },
                    dispose: null
                });

                resourcesSubpath.withResources({ database, duplicateDatabase }, body());
            }, { message: 'Resource name "database" is used by multiple descriptors.' }),
            check.throws(function rejectCycles() {
                resourcesSubpath.withResource(cyclicResource(), body());
            }, { message: 'Resource dependency cycle detected: cycle -> cycle.' })
        ]);
    }
});

const assertResourceWrapperBehavior = defineCompositeAssertion({
    name: 'resource wrapper behavior',
    async assert(check, input: ResourceWrapperBehavior) {
        return check.group([
            engineCasePassedChecks(check.annotated('engine case passed'), await executeEngineCase(input.body)),
            engineCasePassedChecks(check.annotated('engine case passed'), await executeEngineCase(input.resourceBody)),
            runtimeAuthoringMetadataChecks(check.annotated('runtime authoring metadata'), input.body, input.tableBody),
            macroRuntimeMetadataChecks(check.annotated('macro runtime metadata'), input.runtime),
            resourcesSubpathExportsChecks(check.annotated('resources subpath exports')),
            resourceDescriptorsChecks(
                check.annotated('resource descriptors'),
                input.database,
                input.runtime,
                input.temporaryDirectory
            ),
            runtimeAttachmentsChecks(check.annotated('runtime attachments'), input.body),
            directResourceAttachmentsChecks(check.annotated('direct resource attachments'), input.resourceBody)
        ]);
    }
});

export const testNode = suite('Standard distribution entry points', [
    test('@overkill-dev/test/config exposes shared project configuration', function (scope) {
        scope.assert(assertConfigSubpath);

        return scope.assert.collect();
    }),
    test('@overkill-dev/test/reporters exposes current built-in factories', async (scope) => {
        scope.assert.deepEqual(sortedKeys(reportersSubpath), [
            'createBenchmarkHtmlReporter',
            'createBriefFinalResultReporter',
            'createBriefReporter',
            'createDotReporter',
            'createGithubActionsOutputRenderer',
            'createLineProgressReporter',
            'createLineReporter',
            'createLineTreeReporter'
        ]);
        scope.assert.deepEqual(reporterSubpathOutputs(), [
            'line',
            'brief',
            'brief-final-result',
            'dot',
            'progress',
            'tree',
            'hello'
        ]);

        return scope.assert.collect();
    }),
    test('@overkill-dev/test/assert re-exports assertion extension ownership', function (scope) {
        scope.assert(assertAssertSubpath);

        return scope.assert.collect();
    }),
    test('@overkill-dev/test/resources re-exports resource descriptors', async (scope) => {
        const database = resourcesSubpath.defineResource({
            name: 'database',
            scope: 'per-case',
            requirements: [ { kind: 'exclusive-resource', name: 'database' } ],
            acquire() {
                return { url: 'postgres://localhost' };
            },
            dispose: null
        });
        const runtime = resourcesSubpath.defineRuntime({
            name: 'api',
            dimensions: {},
            resources: { database },
            requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ]
        });
        const body = resourcesSubpath.withRuntime(runtime, function runWithDatabase(runtimeScope) {
            runtimeScope.assert.equal(runtime.name, 'api');
            runtimeScope.assert.equal(runtimeScope.runtimes.api.database.url, 'postgres://localhost');

            return runtimeScope.assert.collect();
        });
        const temporaryDirectory = resourcesSubpath.createTemporaryDirectoryResource('scratch');
        const resourceBody = resourcesSubpath.withResource(temporaryDirectory, function runWithScratch(resourceScope) {
            resourceScope.assert.equal(typeof resourceScope.resources.scratch.path, 'string');

            return resourceScope.assert.collect();
        });
        const tableBody = resourcesSubpath.withRuntime<typeof runtime, RuntimeRowInput>(
            runtime,
            function runTableWithDatabase(runtimeScope) {
                runtimeScope.assert.true(runtimeScope.parameters.value > 0);

                return runtimeScope.assert.collect();
            }
        );
        await scope.assert(assertResourceWrapperBehavior, {
            body,
            database,
            resourceBody,
            runtime,
            tableBody,
            temporaryDirectory
        });
        scope.assert(assertResourceWrapperValidation, database, runtime, temporaryDirectory);

        return scope.assert.collect();
    })
]);
