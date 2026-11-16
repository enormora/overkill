import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIfMain } from '#test-runner';
import { suite, test, testDouble, doubleUsage, type TestScope } from './packages/test/test.entry-point.ts';
import {
    createRoot,
    createTestPlan,
    createTestCase,
    defineBodyReference,
    type TestPlan
} from './packages/engine/engine.entry-point.ts';
import {
    declareImplementations,
    catalogFromDeclarations,
    implementationDeclarations
} from './engine/body-reference-plan.ts';
import {
    implementationCatalogSchema,
    mergeImplementationCatalogs,
    type ImplementationCatalog
} from './implementation-catalog.ts';
import { workIdentityKey } from './engine/identity.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function plan(directory: string): TestPlan {
    const url = pathToFileURL(join(directory, 'body.mjs'));
    const body = defineBodyReference({
        module: { moduleUrl: url.href, exportName: 'body' },
        realm: 'host',
        version: '1',
        input: { message: 'identity' },
        dynamicModules: [],
        parseInput() {
            return { message: 'identity' };
        }
    });
    const invalid = defineBodyReference({
        ...body.reference,
        parseInput() {
            throw new TypeError('Excluded invalid input.');
        }
    });
    return createTestPlan(
        createRoot({
            ...metadata,
            title: 'catalog',
            children: [
                createTestCase({ ...metadata, title: 'valid', body }),
                createTestCase({ ...metadata, title: 'invalid', body: invalid })
            ]
        })
    );
}
async function fixture(scope: TestScope, use: (catalog: ImplementationCatalog) => Promise<void>): Promise<void> {
    await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-catalog-'));
    await writeFile(
        join(directory.path, 'body.mjs'),
        "throw new Error('collection evaluated'); export const body={version:'1',implementation:42};"
    );
    const source = plan(directory.path);
    const declared = await declareImplementations(source, { projectRoot: directory.path }, scope.signal);
    const declarations = implementationDeclarations(declared);
    scope.assert.equal(
        declarations.get(workIdentityKey(source.cases[1]?.workId ?? source.cases[0].workId))?.kind,
        'invalid'
    );
    const catalog = catalogFromDeclarations(
        [ declarations.get(workIdentityKey(source.cases[0].workId)) ?? null ],
        directory.path
    );
    if (catalog === null) {
        throw new Error('Expected implementation catalog.');
    }
    await use(catalog);
}
export const testNode = suite('portable implementation catalogs', [
    test('retains non-Error parser failures and does not repeat declaration parsing', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-invalid-catalog-'));
        const body = defineBodyReference({
            module: { moduleUrl: pathToFileURL(join(directory.path, 'absent.mjs')).href, exportName: 'body' },
            realm: 'host',
            version: '1',
            input: null,
            dynamicModules: [],
            parseInput: testDouble.throws<() => null>('input rejected')
        });
        const source = createTestPlan(createRoot({
            ...metadata,
            title: 'invalid input',
            children: [ createTestCase({ ...metadata, title: 'invalid input', body }) ]
        }));
        const declared = await declareImplementations(source, { projectRoot: directory.path }, scope.signal);
        scope.assert.deepEqual(Array.from(implementationDeclarations(declared).values()), [ {
            kind: 'invalid',
            failure: {
                name: 'Error',
                message: 'input rejected',
                detail: { kind: 'string', truncation: null, value: 'input rejected' }
            }
        } ]);
        scope.assert.throws(function selectedInvalidInput() {
            catalogFromDeclarations(Array.from(implementationDeclarations(declared).values()), directory.path);
        }, { message: 'input rejected' });
        await declareImplementations(declared, { projectRoot: directory.path }, scope.signal);
        scope.assert(doubleUsage.calledOnce, body.reference.parseInput);
        return scope.assert.collect();
    }),
    test('rejects merging catalogs prepared under different project roots', async function (scope) {
        await fixture(scope, async function conflict(catalog) {
            scope.assert.throws(function mergeRoots() {
                mergeImplementationCatalogs([ catalog, {
                    ...catalog,
                    projectRoot: join(catalog.projectRoot, 'other')
                } ]);
            }, { message: 'Implementation project roots differ.' });
        });
        return scope.assert.collect();
    }),
    test('rejects merging catalogs from different native runtimes', async function (scope) {
        await fixture(scope, async function conflict(catalog) {
            const changed = {
                ...catalog,
                builds: catalog.builds.map(function runtime(build) {
                    return { ...build, graph: { ...build.graph, runtime: { ...build.graph.runtime, node: 'v0.0.0' } } };
                })
            };
            scope.assert.throws(function mergeRuntimes() {
                mergeImplementationCatalogs([ catalog, changed ]);
            }, { message: 'Implementation runtimes differ.' });
        });
        return scope.assert.collect();
    }),
    test('rejects catalogs that resolve the same entry to different modules', async function (scope) {
        await fixture(scope, async function conflict(catalog) {
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
        });
        return scope.assert.collect();
    }),
    test(
        'collects data-only identity without evaluating modules or admitting excluded invalid work',
        async function (scope) {
            await fixture(scope, async function inspect(catalog) {
                const encoded = JSON.stringify(catalog);
                scope.assert.equal(encoded.includes('collection evaluated'), false);
                scope.assert.equal(encoded.includes('parseInput'), false);
                scope.assert.deepEqual(implementationCatalogSchema.parse(JSON.parse(encoded)), catalog);
            });
            return scope.assert.collect();
        }
    ),
    test('retains assignments from distinct shards sharing the same module build', async function (scope) {
        await fixture(scope, async function combine(catalog) {
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
        });
        return scope.assert.collect();
    }),
    test('rejects conflicting parsed input for overlapping work', async function (scope) {
        await fixture(scope, async function conflict(catalog) {
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
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
