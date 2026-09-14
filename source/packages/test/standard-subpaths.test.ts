import {
    createSuite,
    createTestCase,
    readTestBodyResourceAttachments,
    type TestScope
} from '../engine/engine.entry-point.ts';
import { createReportingContext } from '../../engine/reporting-context.ts';
import * as assertSubpath from './assert.entry-point.ts';
import * as baselinesSubpath from './baselines.entry-point.ts';
import * as benchSubpath from './bench.entry-point.ts';
import * as configSubpath from './config.entry-point.ts';
import * as reportersSubpath from './reporters.entry-point.ts';
import * as resourcesSubpath from './resources.entry-point.ts';
import {
    createTestFacade,
    table,
    test,
    type ParameterizedTestScope
} from './test.entry-point.ts';

type ReservedSubpathModule = {
    readonly name: string;
    readonly module: {
        readonly unavailable: (...parameters: readonly unknown[]) => never;
    };
};

const reservedSubpathModules: readonly ReservedSubpathModule[] = [
    { module: baselinesSubpath, name: 'baselines' },
    { module: benchSubpath, name: 'bench' }
];
const invokeTable = table as (...parameters: readonly unknown[]) => unknown;
const invokeTest = test as (...parameters: readonly unknown[]) => unknown;
const invokeWithResource = resourcesSubpath.withResource as (...parameters: readonly unknown[]) => unknown;
const invokeWithResources = resourcesSubpath.withResources as (...parameters: readonly unknown[]) => unknown;
const invokeWithRuntime = resourcesSubpath.withRuntime as (...parameters: readonly unknown[]) => unknown;

type BoundaryRow = {
    readonly value: number;
};
type NamedResourceDescriptor = {
    readonly name: string;
};
type NamedRuntimeDescriptor = {
    readonly id: {
        readonly name: string;
    };
    readonly resources: Readonly<Record<string, unknown>>;
};
type CycleDependencies = {
    readonly self: resourcesSubpath.ResourceDefinition<'cycle', string, CycleDependencies>;
};
type ResourceWrapperBehavior = {
    readonly body: resourcesSubpath.RuntimeWrappedTestBody;
    readonly database: NamedResourceDescriptor;
    readonly resourceBody: resourcesSubpath.ResourceWrappedTestBody;
    readonly runtime: NamedRuntimeDescriptor;
    readonly tableBody: resourcesSubpath.RuntimeWrappedTestBody<
        resourcesSubpath.RuntimeGraph,
        ParameterizedTestScope<BoundaryRow>
    >;
    readonly temporaryDirectory: NamedResourceDescriptor;
};

function sortedKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
    return Object.keys(value).toSorted(function compareExportNames(left, right) {
        return left.localeCompare(right);
    });
}

function assertConfigSubpath(scope: TestScope): void {
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

    scope.assert.deepEqual(sortedKeys(configSubpath), [ 'defineConfig' ]);
    scope.assert.equal(configSubpath.defineConfig(config), config);
    scope.assert.equal(Object.hasOwn(configSubpath, 'orchestrator'), false);
    scope.assert.equal(Object.hasOwn(configSubpath, 'loadRunConfig'), false);
}

async function assertReporterSubpath(scope: TestScope): Promise<void> {
    const context = createReportingContext({ projectRoot: null });
    const line = reportersSubpath.createLineReporter()(context);
    const brief = reportersSubpath.createBriefReporter()(context);
    const dot = reportersSubpath.createDotReporter()(context);
    const githubActions = reportersSubpath.createGithubActionsOutputRenderer()(context);

    scope.assert.deepEqual(sortedKeys(reportersSubpath), [
        'createBriefReporter',
        'createDotReporter',
        'createGithubActionsOutputRenderer',
        'createLineReporter'
    ]);
    scope.assert.deepEqual([
        line.name,
        brief.name,
        dot.name,
        githubActions.render({
            annotation: null,
            kind: 'stdout-line',
            role: 'primary',
            text: 'hello'
        })
    ], [ 'line', 'brief', 'dot', 'hello' ]);

    if (dot.dispose !== null) {
        await dot.dispose();
    }
}

function assertAssertSubpath(scope: TestScope): void {
    scope.assert.deepEqual(sortedKeys(assertSubpath), [
        'defineCompositeAssertion',
        'defineNarrowingCompositeAssertion'
    ]);
    scope.assert.equal(typeof assertSubpath.defineCompositeAssertion, 'function');
}

function assertResourcesSubpathExports(scope: TestScope): void {
    scope.assert.deepEqual(sortedKeys(resourcesSubpath), [
        'composeRuntimeContext',
        'createTemporaryDirectoryResource',
        'defineResource',
        'defineRuntime',
        'ResourceLifecycleError',
        'startRuntime',
        'withResource',
        'withResources',
        'withRuntime'
    ]);
    scope.assert.equal(typeof resourcesSubpath.startRuntime, 'function');
}

function assertRuntimeAuthoringBoundary(
    scope: TestScope,
    body: resourcesSubpath.RuntimeWrappedTestBody,
    tableBody: resourcesSubpath.RuntimeWrappedTestBody<
        resourcesSubpath.RuntimeGraph,
        ParameterizedTestScope<BoundaryRow>
    >
): void {
    const integrationFacade = createTestFacade({ testFamily: 'integration' });
    const runtimeTable = integrationFacade.table({
        cases: [ { value: 1 }, { value: 2 } ],
        test: tableBody,
        title: 'rows'
    });

    scope.assert.equal(integrationFacade.test('uses database', body).kind, 'test');
    scope.assert.equal(runtimeTable.kind, 'table');
    scope.assert.throws(function createMicrotestRuntimeCase() {
        invokeTest('uses database', body);
    }, { message: 'Microtest authoring does not support resource or runtime attachments.' });
    scope.assert.throws(function createMicrotestRuntimeTable() {
        invokeTable({
            cases: [ { value: 1 }, { value: 2 } ],
            test: tableBody,
            title: 'rows'
        });
    }, { message: 'Microtest authoring does not support resource or runtime attachments.' });
}

function assertResourceDescriptors(
    scope: TestScope,
    database: NamedResourceDescriptor,
    runtime: NamedRuntimeDescriptor,
    temporaryDirectory: NamedResourceDescriptor
): void {
    scope.assert.equal(database.name, 'database');
    scope.assert.equal(runtime.id.name, 'api');
    scope.assert.deepEqual(Object.keys(runtime.resources), [ 'database' ]);
    scope.assert.equal(temporaryDirectory.name, 'scratch');
}

function assertRuntimeAttachments(
    scope: TestScope,
    body: resourcesSubpath.RuntimeWrappedTestBody
): void {
    scope.assert.deepEqual(readTestBodyResourceAttachments(body), {
        directResources: [],
        resourceGraph: [
            {
                dependencies: [],
                name: 'database',
                requirements: [ { kind: 'exclusive-resource', name: 'database' } ],
                scope: 'per-case'
            }
        ],
        runtimeGraphs: [
            {
                dimensions: {},
                name: 'api',
                requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ],
                resources: [ { key: 'database', resourceName: 'database' } ]
            }
        ]
    });
}

function assertDirectResourceAttachments(
    scope: TestScope,
    body: resourcesSubpath.ResourceWrappedTestBody
): void {
    scope.assert.deepEqual(readTestBodyResourceAttachments(body), {
        directResources: [ { key: 'scratch', resourceName: 'scratch' } ],
        resourceGraph: [
            {
                dependencies: [],
                name: 'scratch',
                requirements: [],
                scope: 'per-case'
            }
        ],
        runtimeGraphs: []
    });
}

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

function assertResourceWrapperValidation(
    scope: TestScope,
    database: resourcesSubpath.AnyResourceDefinition,
    runtime: resourcesSubpath.RuntimeGraph,
    temporaryDirectory: resourcesSubpath.AnyResourceDefinition
): void {
    const body = function resourceBody() {
        return function runResourceValidation(resourceScope: TestScope) {
            return resourceScope.assert.collect();
        };
    };

    scope.assert.throws(function rejectInvalidResource() {
        invokeWithResource({ name: 'invalid' }, body());
    }, { message: 'withResource() requires resource descriptors.' });
    scope.assert.throws(function rejectInvalidRuntime() {
        invokeWithRuntime({ name: 'invalid' }, body());
    }, { message: 'withRuntime() requires a runtime descriptor.' });
    scope.assert.throws(function rejectEmptyResources() {
        invokeWithResources({}, body());
    }, { message: 'withResources() requires at least one resource descriptor.' });
    scope.assert.throws(function rejectNestedWrapper() {
        resourcesSubpath.withResource(temporaryDirectory, resourcesSubpath.withRuntime(runtime, body()));
    }, { message: 'withResource() does not support already wrapped bodies yet.' });
    scope.assert.throws(function rejectDuplicateNames() {
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
    }, { message: 'Resource name "database" is used by multiple descriptors.' });
    scope.assert.throws(function rejectCycles() {
        resourcesSubpath.withResource(cyclicResource(), body());
    }, { message: 'Resource dependency cycle detected: cycle -> cycle.' });
}

function assertResourceWrapperBehavior(scope: TestScope, input: ResourceWrapperBehavior): void {
    scope.assert.equal(Array.isArray(input.body(scope)), true);
    assertRuntimeAuthoringBoundary(scope, input.body, input.tableBody);
    assertResourcesSubpathExports(scope);
    assertResourceDescriptors(scope, input.database, input.runtime, input.temporaryDirectory);
    assertRuntimeAttachments(scope, input.body);
    assertDirectResourceAttachments(scope, input.resourceBody);
}

function assertResourcesSubpath(scope: TestScope): void {
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

        return runtimeScope.assert.collect();
    });
    const temporaryDirectory = resourcesSubpath.createTemporaryDirectoryResource('scratch');
    const resourceBody = resourcesSubpath.withResource(temporaryDirectory, function runWithScratch(resourceScope) {
        return resourceScope.assert.collect();
    });
    const tableBody = resourcesSubpath.withRuntime<typeof runtime, ParameterizedTestScope<{ readonly value: number; }>>(
        runtime,
        function runTableWithDatabase(runtimeScope) {
            runtimeScope.assert.true(runtimeScope.parameters.value > 0);

            return runtimeScope.assert.collect();
        }
    );

    assertResourceWrapperBehavior(scope, {
        body,
        database,
        resourceBody,
        runtime,
        tableBody,
        temporaryDirectory
    });
    assertResourceWrapperValidation(scope, database, runtime, temporaryDirectory);
}

function assertReservedSubpath(scope: TestScope, subpath: ReservedSubpathModule): void {
    scope.assert.deepEqual(sortedKeys(subpath.module), [ 'unavailable' ]);
    scope.assert.throws(function invokeUnavailableSubpath() {
        subpath.module.unavailable('ignored');
    }, {
        message: `The @overkill-dev/test/${subpath.name} subpath is reserved until its leaf package exists.`
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/standard-subpaths.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/config exposes config authoring only',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertConfigSubpath(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/reporters exposes current built-in factories',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertReporterSubpath(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/assert re-exports assertion extension ownership',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertAssertSubpath(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test/resources re-exports resource descriptors',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertResourcesSubpath(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test reserved subpaths expose sentinel only',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                for (const subpath of reservedSubpathModules) {
                    assertReservedSubpath(scope, subpath);
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
