import { join } from 'node:path';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { memoryImplementationCatalog } from './test-support/memory-implementation-catalog.ts';
import {
    mergeImplementationCatalogs,
    combineImplementationBuilds,
    selectedImplementationAssignments,
    assertImplementationAssignments
} from './implementation-catalog.ts';

export const testNode = suite('portable implementation catalog policy', [
    test('combines repeated build evidence without duplicating assignments or modules', function (scope) {
        const catalog = memoryImplementationCatalog();
        const combined = combineImplementationBuilds([ ...catalog.builds, ...catalog.builds ]);
        scope.assert.deepEqual<unknown, unknown>(combined, catalog.builds[0]);
        scope.assert.deepEqual<unknown, unknown>(mergeImplementationCatalogs([ catalog, null, catalog ]), catalog);
        scope.assert.equal(mergeImplementationCatalogs([ null ]), null);
        scope.assert.throws(function () {
            combineImplementationBuilds([]);
        }, { message: 'Expected implementation builds.' });
        return scope.assert.collect();
    }),
    test('selects assignments by complete work identity boundaries', function (scope) {
        const catalog = memoryImplementationCatalog();
        scope.assert.deepEqual<unknown, unknown>(
            selectedImplementationAssignments(catalog, [ 'first' ]),
            catalog.builds[0]?.assignments
        );
        scope.assert.deepEqual(selectedImplementationAssignments(catalog, [ 'fir', 'first-other' ]), []);
        scope.assert.deepEqual(selectedImplementationAssignments(catalog, []), []);
        return scope.assert.collect();
    }),
    test('checks frozen assignment facts independently of entry ordering', function (scope: TestScope) {
        const assignments = memoryImplementationCatalog().builds[0]?.assignments;
        scope.require.defined(assignments);
        assertImplementationAssignments(assignments, assignments.toReversed());
        scope.assert.throws(function () {
            assertImplementationAssignments(assignments, []);
        }, { message: 'Frozen implementation assignments changed; prepare and collect a new run.' });
        scope.assert.throws(function () {
            assertImplementationAssignments(
                assignments,
                assignments.map(function (entry) {
                    return { ...entry, binding: 'changed' };
                })
            );
        }, { message: 'Frozen implementation assignments changed; prepare and collect a new run.' });
        return scope.assert.collect();
    }),
    test('rejects conflicting evidence for the same module URL', function (scope) {
        const catalog = memoryImplementationCatalog();
        const changed = {
            ...catalog,
            builds: catalog.builds.map(function (build) {
                return {
                    ...build,
                    graph: {
                        ...build.graph,
                        modules: build
                            .graph
                            .modules
                            .map(function (module) {
                                return { ...module, format: 'json' as const };
                            })
                    }
                };
            })
        };
        scope.assert.throws(function () {
            mergeImplementationCatalogs([ catalog, changed ]);
        }, { message: 'Implementation module builds differ.' });
        return scope.assert.collect();
    }),
    test('rejects merging catalogs prepared under different project roots', function (scope) {
        const catalog = memoryImplementationCatalog();
        scope.assert.throws(function mergeRoots() {
            mergeImplementationCatalogs([ catalog, {
                ...catalog,
                projectRoot: join(catalog.projectRoot, 'other')
            } ]);
        }, { message: 'Implementation project roots differ.' });
        return scope.assert.collect();
    }),
    test('rejects merging catalogs from different native runtimes', function (scope) {
        const catalog = memoryImplementationCatalog();
        const changed = {
            ...catalog,
            builds: catalog.builds.map(function runtime(build) {
                return { ...build, graph: { ...build.graph, runtime: { ...build.graph.runtime, node: 'v0.0.0' } } };
            })
        };
        scope.assert.throws(function mergeRuntimes() {
            mergeImplementationCatalogs([ catalog, changed ]);
        }, { message: 'Implementation runtimes differ.' });
        return scope.assert.collect();
    }),
    test('rejects catalogs that resolve the same entry to different modules', function (scope) {
        const catalog = memoryImplementationCatalog();
        const changed = {
            ...catalog,
            builds: catalog.builds.map(function entryResolution(build) {
                return {
                    ...build,
                    graph: {
                        ...build.graph,
                        entries: Object.fromEntries(
                            Object.entries(build.graph.entries).map(function redirect([ key, url ]) {
                                const target = new URL('other.mjs', url);
                                return [ key, target.href ];
                            })
                        )
                    }
                };
            })
        };
        scope.assert.throws(function mergeEntries() {
            mergeImplementationCatalogs([ catalog, changed ]);
        }, { message: 'Implementation entry resolutions differ.' });
        return scope.assert.collect();
    }),
    test('retains assignments from distinct shards sharing the same module build', function (scope) {
        const catalog = memoryImplementationCatalog();
        const other = {
            ...catalog,
            builds: catalog.builds.map(function shard(build) {
                return {
                    ...build,
                    assignments: build.assignments.map(function assignment(entry) {
                        return { ...entry, key: `another:${entry.key}` };
                    })
                };
            })
        };
        const merged = mergeImplementationCatalogs([ catalog, other ]);
        scope.assert.equal(merged?.builds.length, 1);
        scope.assert.equal(merged?.builds[0]?.assignments.length, 2);
        return scope.assert.collect();
    }),
    test('rejects conflicting parsed input for overlapping work', function (scope) {
        const catalog = memoryImplementationCatalog();
        const changed = {
            ...catalog,
            builds: catalog.builds.map(function input(build) {
                return {
                    ...build,
                    assignments: build.assignments.map(function assignment(entry) {
                        return { ...entry, facts: { ...entry.facts, input: 'changed' } };
                    })
                };
            })
        };
        scope.assert.throws(function merge() {
            mergeImplementationCatalogs([ catalog, changed ]);
        }, { message: 'Implementation assignments differ.' });
        return scope.assert.collect();
    })
]);
