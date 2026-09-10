import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { createReportingContext } from '../../engine/reporting-context.ts';
import { defineCompositeAssertion } from './assert.entry-point.ts';
import * as assertSubpath from './assert.entry-point.ts';
import * as baselinesSubpath from './baselines.entry-point.ts';
import * as benchSubpath from './bench.entry-point.ts';
import { defineConfig } from './config.entry-point.ts';
import * as configSubpath from './config.entry-point.ts';
import * as reportersSubpath from './reporters.entry-point.ts';
import * as resourcesSubpath from './resources.entry-point.ts';

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
    scope.assert.equal(defineConfig(config), config);
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
    scope.assert.equal(typeof defineCompositeAssertion, 'function');
}

function assertResourcesSubpathExports(scope: TestScope): void {
    scope.assert.deepEqual(sortedKeys(resourcesSubpath), [
        'composeRuntimeContext',
        'createTemporaryDirectoryResource',
        'defineResource',
        'defineRuntime',
        'ResourceLifecycleError',
        'startRuntime',
        'withRuntime'
    ]);
    scope.assert.equal(typeof resourcesSubpath.startRuntime, 'function');
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
    const body = resourcesSubpath.withRuntime(runtime, {
        database: { url: 'postgres://localhost' }
    }, function runWithDatabase(runtimeScope) {
        runtimeScope.assert.equal(runtimeScope.runtime.database.url, 'postgres://localhost');

        return runtimeScope.assert.collect();
    });
    const temporaryDirectory = resourcesSubpath.createTemporaryDirectoryResource('scratch');

    scope.assert.equal(Array.isArray(body(scope)), true);
    assertResourcesSubpathExports(scope);
    scope.assert.equal(database.name, 'database');
    scope.assert.equal(runtime.id.name, 'api');
    scope.assert.deepEqual(Object.keys(runtime.resources), [ 'database' ]);
    scope.assert.equal(temporaryDirectory.name, 'scratch');
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
