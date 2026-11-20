import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { deliverImplementationSource } from '../../implementation-source-map.ts';
import { implementationMap, inlineImplementationMap } from '../../test-support/implementation-source-maps.ts';

const moduleUrl = 'file:///project/body.mjs';
export const testNode: TestNode = suite('immutable inline implementation source maps', [
    test('preserves sources without map directives', async function (scope) {
        const source = 'export const value = 42;';
        scope.assert.deepEqual(await deliverImplementationSource(source, moduleUrl), { source, sourceMap: null });
        return scope.assert.collect();
    }),
    test('ignores directive text inside string literals', async function (scope) {
        const source = 'export const value = "//# sourceMappingURL=missing.map";';
        scope.assert.deepEqual(await deliverImplementationSource(source, moduleUrl), { source, sourceMap: null });
        return scope.assert.collect();
    }),
    table({
        title: 'normalizes inline maps to immutable absolute origins',
        cases: [ 'base64', 'percent' ] as const,
        caseTitle(encoding) {
            return encoding;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const reference = inlineImplementationMap(implementationMap, scope.parameters);
            const source = `export const value = 42;\n//# sourceMappingURL=${reference}`;
            const delivered = await deliverImplementationSource(source, moduleUrl);
            scope.assert.deepEqual<unknown, unknown>(delivered.sourceMap, {
                url: reference,
                source: JSON.stringify(implementationMap)
            });
            scope.assert.equal(Object.isFrozen(delivered.sourceMap), true);
            const encoded = delivered.source.split('base64,').at(-1);
            require.defined(encoded);
            scope.assert.partialDeepEqual<unknown, unknown>(JSON.parse(Buffer.from(encoded, 'base64').toString()), {
                sources: [ 'file:///project/original.ts' ],
                sourcesContent: implementationMap.sourcesContent,
                mappings: 'AAAA'
            });
            return scope.assert.collect();
        }
    }),
    test('uses the last map and removes every obsolete map directive', async function (scope) {
        const reference = inlineImplementationMap(implementationMap, 'base64');
        const source =
            `//# sourceMappingURL=missing.map\nexport const value = 42;\n/*# sourceMappingURL=${reference} */`;
        const delivered = await deliverImplementationSource(source, moduleUrl);
        scope.assert.equal(delivered.source.includes('missing.map'), false);
        scope.assert.equal(delivered.source.split('\n', 2)[1], 'export const value = 42;');
        scope.assert.equal(delivered.sourceMap?.url, reference);
        return scope.assert.collect();
    }),
    test(
        'preserves Unicode and line boundaries while replacing map comments',
        async function (scope) {
            const map = { ...implementationMap, sourcesContent: [ 'export const value = "ä";' ] };
            const reference = inlineImplementationMap(map, 'percent');
            const source = `export const value = "ä";\r\n/*# sourceMappingURL=${reference} */\r\n`;
            const delivered = await deliverImplementationSource(source, moduleUrl);
            scope.assert.equal(delivered.source.startsWith('export const value = "ä";\r\n'), true);
            scope.assert.equal(delivered.sourceMap?.source, JSON.stringify(map));
            return scope.assert.collect();
        }
    ),
    test(
        'rejects invalid JSON rather than retaining a mutable map reference',
        async function (scope) {
            await scope.assert.rejects(async function () {
                return await deliverImplementationSource(
                    'export const value = 42;\n//# sourceMappingURL=data:application/json,%7B',
                    moduleUrl
                );
            }, { name: 'SyntaxError' });
            return scope.assert.collect();
        }
    ),
    test('rejects maps with invalid mapping syntax or coordinates', async function (scope) {
        await scope.assert.rejects(async function () {
            return await deliverImplementationSource(
                `export const value = 42;\n//# sourceMappingURL=${
                    inlineImplementationMap({ ...implementationMap, mappings: '!' }, 'base64')
                }`,
                moduleUrl
            );
        }, { name: 'ZodError' });
        await scope.assert.rejects(async function () {
            return await deliverImplementationSource(
                `export const value = 42;\n//# sourceMappingURL=${
                    inlineImplementationMap({ ...implementationMap, sources: [] }, 'base64')
                }`,
                moduleUrl
            );
        }, { message: 'Source map has no usable original mappings.' });
        return scope.assert.collect();
    }),
    test('flattens indexed inline maps before delivery', async function (scope: TestScope) {
        const map = { version: 3, sections: [ { offset: { line: 0, column: 0 }, map: implementationMap } ] };
        const delivered = await deliverImplementationSource(
            `export const value = 42;\n//# sourceMappingURL=${inlineImplementationMap(map, 'base64')}`,
            moduleUrl
        );
        const encoded = delivered.source.split('base64,').at(-1);
        scope.require.defined(encoded);
        scope.assert.partialDeepEqual<unknown, unknown>(JSON.parse(Buffer.from(encoded, 'base64').toString()), {
            sources: [ 'file:///project/original.ts' ],
            mappings: 'AAAA'
        });
        return scope.assert.collect();
    })
]);
