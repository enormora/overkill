import { createSuite, createTestCase, runIfMain, type TestScope } from '../engine/engine.entry-point.ts';
import { createLineReporter } from '../reporter-line/reporter-line.entry-point.ts';
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
    { module: benchSubpath, name: 'bench' },
    { module: resourcesSubpath, name: 'resources' }
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
    const line = reportersSubpath.createLineReporter();
    const brief = reportersSubpath.createBriefReporter();
    const dot = reportersSubpath.createDotReporter();
    const githubActions = reportersSubpath.createGithubActionsOutputRenderer();

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

function assertReservedSubpath(scope: TestScope, subpath: ReservedSubpathModule): void {
    scope.assert.deepEqual(sortedKeys(subpath.module), [ 'unavailable' ]);
    scope.assert.throws(function invokeUnavailableSubpath() {
        subpath.module.unavailable('ignored');
    }, {
        message: `The @overkill-dev/test/${subpath.name} subpath is reserved until its leaf package exists.`
    });
}

export const testSuite = createSuite({
    title: 'source/packages/test/standard-subpaths.test.ts',
    metadata: {},
    children: [
        createTestCase({
            title: '@overkill-dev/test/config exposes config authoring only',
            metadata: {},
            body(scope: TestScope) {
                assertConfigSubpath(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: '@overkill-dev/test/reporters exposes current built-in factories',
            metadata: {},
            async body(scope: TestScope) {
                await assertReporterSubpath(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: '@overkill-dev/test/assert re-exports assertion extension ownership',
            metadata: {},
            body(scope: TestScope) {
                assertAssertSubpath(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: '@overkill-dev/test reserved subpaths expose sentinel only',
            metadata: {},
            body(scope: TestScope) {
                for (const subpath of reservedSubpathModules) {
                    assertReservedSubpath(scope, subpath);
                }

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
