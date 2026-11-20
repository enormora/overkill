import { type TestNode, type TestScope, suite, test, testDouble, doubleUsage } from '@overkill-dev/test';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    defineBodyReference,
    type TestPlan,
    createRoot,
    createTestPlan,
    createTestCase
} from '../../packages/engine/engine.entry-point.ts';
import {
    declareImplementations,
    catalogFromDeclarations,
    implementationDeclarations
} from '../../engine/body-reference-plan.ts';
import { implementationCatalogSchema, type ImplementationCatalog } from '../../implementation-catalog.ts';
import { workIdentityKey } from '../../engine/identity.ts';

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
export const testNode: TestNode = suite('portable implementation catalogs', [
    test(
        'retains non-Error parser failures and does not repeat declaration parsing',
        async function (scope) {
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
        }
    ),

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
    )
]);
