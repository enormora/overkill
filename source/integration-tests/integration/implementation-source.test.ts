import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { implementationFormat, implementationImports } from '../../implementation-source.ts';

export const testNode: TestNode = suite('native implementation source inspection', [
    test('ignores local exports while retaining side-effect and literal dynamic imports', function (scope) {
        scope.assert.deepEqual(
            implementationImports(
                [
                    "import 'node:fs';",
                    'const value = 42; export { value };',
                    'await import(`node:path`);'
                ]
                    .join('\n'),
                'file:///project/body.mjs'
            ),
            [ 'node:fs', 'node:path' ]
        );
        return scope.assert.collect();
    }),
    table({
        title: 'recognizes native',
        cases: [ [ 'js', 'module' ], [ 'ts', 'module-typescript' ] ] as const,
        caseTitle([ extension ]) {
            return `recognizes native ${extension} modules inside module packages`;
        },
        test(scope) {
            const [ extension, format ] = scope.parameters;

            scope.assert.equal(
                implementationFormat(`file:///project/body.${extension}`, [ {
                    url: 'file:///project/package.json',
                    source: JSON.stringify({ type: 'module' })
                } ]),
                format
            );
            return scope.assert.collect();
        }
    }),
    test('honors the nearest package type instead of an ancestor module declaration', function (scope) {
        scope.assert.throws(function commonJsPackage() {
            implementationFormat('file:///project/nested/body.js', [
                { url: 'file:///project/nested/package.json', source: '{}' },
                { url: 'file:///project/package.json', source: JSON.stringify({ type: 'module' }) }
            ]);
        }, { message: 'Unsupported portable implementation format: file:///project/nested/body.js' });
        scope.assert.throws(function unsupportedExtension() {
            implementationFormat('file:///project/body.cjs', [ {
                url: 'file:///project/package.json',
                source: JSON.stringify({ type: 'module' })
            } ]);
        }, { message: 'Unsupported portable implementation format: file:///project/body.cjs' });
        return scope.assert.collect();
    }),
    test('preserves runtime imports containing only inline type specifiers', function (scope) {
        const source = [
            "import type { Erased } from './erased.mts';",
            "import { type Kept } from './kept.mts';",
            "import {} from './side-effect.mjs';",
            "export type { Erased } from './erased-export.mts';",
            "export { type Kept } from './kept-export.mts';",
            "await import('./dynamic.mjs');"
        ]
            .join('\n');
        scope.assert.deepEqual(
            new Set(implementationImports(source, 'file:///project/body.mts')),
            new Set([
                './kept.mts',
                './side-effect.mjs',
                './kept-export.mts',
                './dynamic.mjs'
            ])
        );
        return scope.assert.collect();
    }),
    test('requires explicit candidates instead of guessing computed imports', function (scope) {
        scope.assert.deepEqual(
            implementationImports("const name = './target.mjs'; await import(name);", 'file:///project/body.mjs'),
            []
        );
        return scope.assert.collect();
    }),
    test('rejects CommonJS and native-addon formats', function (scope) {
        scope.assert.throws(function commonJs() {
            implementationFormat('file:///project/body.cjs', []);
        }, { type: TypeError });
        scope.assert.throws(function nativeAddon() {
            implementationFormat('file:///project/body.node', []);
        }, { type: TypeError });
        return scope.assert.collect();
    })
]);
