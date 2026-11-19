import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { testNode as mappings } from './source-map-data.test.ts';

import { deliverImplementationSource } from './implementation-source-map.ts';
import { implementationMap, inlineImplementationMap } from './test-support/implementation-source-maps.ts';

const moduleUrl = 'file:///project/body.mjs';
export const testNode = authoredSuite('immutable inline implementation source maps', [
    mappings,
    authoredTest('preserves sources without map directives', async function (scope: TestScope) {
        const source = 'export const value = 42;';
        scope.assert.deepEqual(await deliverImplementationSource(source, moduleUrl), { source, sourceMap: null });
        return scope.assert.collect();
    }),
    authoredTest('ignores directive text inside string literals', async function (scope: TestScope) {
        const source = 'export const value = "//# sourceMappingURL=missing.map";';
        scope.assert.deepEqual(await deliverImplementationSource(source, moduleUrl), { source, sourceMap: null });
        return scope.assert.collect();
    }),
    ...([ 'base64', 'percent' ] as const).map(function (encoding) {
        return authoredTest(
            `normalizes ${encoding} inline maps to immutable absolute origins`,
            async function (scope: TestScope) {
                const reference = inlineImplementationMap(implementationMap, encoding);
                const source = `export const value = 42;\n//# sourceMappingURL=${reference}`;
                const delivered = await deliverImplementationSource(source, moduleUrl);
                scope.assert.deepEqual<unknown, unknown>(delivered.sourceMap, {
                    url: reference,
                    source: JSON.stringify(implementationMap)
                });
                scope.assert.equal(Object.isFrozen(delivered.sourceMap), true);
                const encoded = delivered.source.split('base64,').at(-1);
                scope.require.defined(encoded);
                scope.assert.partialDeepEqual<unknown, unknown>(JSON.parse(Buffer.from(encoded, 'base64').toString()), {
                    sources: [ 'file:///project/original.ts' ],
                    sourcesContent: implementationMap.sourcesContent,
                    mappings: 'AAAA'
                });
                return scope.assert.collect();
            }
        );
    }),
    authoredTest('uses the last map and removes every obsolete map directive', async function (scope: TestScope) {
        const reference = inlineImplementationMap(implementationMap, 'base64');
        const source =
            `//# sourceMappingURL=missing.map\nexport const value = 42;\n/*# sourceMappingURL=${reference} */`;
        const delivered = await deliverImplementationSource(source, moduleUrl);
        scope.assert.equal(delivered.source.includes('missing.map'), false);
        scope.assert.equal(delivered.source.split('\n', 2)[1], 'export const value = 42;');
        scope.assert.equal(delivered.sourceMap?.url, reference);
        return scope.assert.collect();
    }),
    authoredTest(
        'preserves Unicode and line boundaries while replacing map comments',
        async function (scope: TestScope) {
            const map = { ...implementationMap, sourcesContent: [ 'export const value = "ä";' ] };
            const reference = inlineImplementationMap(map, 'percent');
            const source = `export const value = "ä";\r\n/*# sourceMappingURL=${reference} */\r\n`;
            const delivered = await deliverImplementationSource(source, moduleUrl);
            scope.assert.equal(delivered.source.startsWith('export const value = "ä";\r\n'), true);
            scope.assert.equal(delivered.sourceMap?.source, JSON.stringify(map));
            return scope.assert.collect();
        }
    ),
    authoredTest(
        'rejects invalid JSON rather than retaining a mutable map reference',
        async function (scope: TestScope) {
            await scope.assert.rejects(async function () {
                return await deliverImplementationSource(
                    'export const value = 42;\n//# sourceMappingURL=data:application/json,%7B',
                    moduleUrl
                );
            }, { name: 'SyntaxError' });
            return scope.assert.collect();
        }
    ),
    authoredTest('rejects maps with invalid mapping syntax or coordinates', async function (scope: TestScope) {
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
    authoredTest('flattens indexed inline maps before delivery', async function (scope: TestScope) {
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
