import { runIfMain } from '#test-runner';
import { suite, test } from './packages/test/test.entry-point.ts';
import { implementationFormat, implementationImports } from './implementation-source.ts';

export const testNode = suite('native implementation source inspection', [
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
await runIfMain(import.meta, testNode);
