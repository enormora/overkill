import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from './packages/test/test.entry-point.ts';
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
