import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { createCoverageSourceCache } from './coverage-runtime-source.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'source/run/coverage-runtime-source.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'reuses method positions without retaining coverage counts',
            body(scope) {
                const cache = createCoverageSourceCache();
                const source = 'const box = { replace(value) { return value; } };';
                const inspection = cache.inspect(source, 'source.js');

                for (const count of [ 1, 4, 0 ]) {
                    const functions = [ {
                        functionName: 'replace',
                        isBlockCoverage: true,
                        ranges: [ {
                            count,
                            startOffset: source.indexOf('replace'),
                            endOffset: source.indexOf(' }') + 2
                        } ]
                    } ];
                    const expected = [ {
                        ...functions[0],
                        ranges: [ { ...functions[0]?.ranges[0], startOffset: source.indexOf('(') } ]
                    } ];

                    scope.assert.deepEqual(inspection.normalize(functions), expected);
                    scope.assert.equal(functions[0]?.ranges[0]?.startOffset, source.indexOf('replace'));
                }
                return scope.assert.collect();
            }
        }),
        ...[
            { source: '', runtime: false },
            { source: `${String.fromCodePoint(65_279)} /* documentation */ \n // more documentation`, runtime: false },
            { source: '#!/usr/bin/env node\n; ;', runtime: false },
            { source: 'export {}', runtime: false },
            { source: 'export /* comment */ { /* comment */ }; ; export {};', runtime: false },
            { source: 'interface Box { value: string }', runtime: false },
            { source: 'export type Box<T> = { value: T };', runtime: false },
            { source: 'import type { Box } from "./missing.ts"; export type { Box };', runtime: false },
            { source: 'declare const value: number; export {};', runtime: false },
            { source: 'declare class Box { replace<T>(value: T): T; }', runtime: false },
            { source: 'declare namespace Box { type Value = string; }', runtime: false },
            { source: [ 'type Box = `value:', '{string}`; export {};' ].join('$'), runtime: false },
            { source: 'import "./effect.ts";', runtime: true },
            { source: 'import {} from "./effect.ts";', runtime: true },
            { source: 'export {} from "./effect.ts";', runtime: true },
            { source: 'export * from "./effect.ts";', runtime: true },
            { source: 'export {}; const value: number = 42;', runtime: true },
            { source: 'export {}; `literal // comment`;', runtime: true },
            { source: '/[/*]/;', runtime: true },
            { source: '"// comment";', runtime: true },
            { source: 'class Box {}', runtime: true },
            { source: 'function replace<T>(value: T): T { return value; }', runtime: true }
        ]
            .map(function sourceCase(scenario) {
                return createTestCase({
                    ...metadata,
                    title: `classifies runtime in ${JSON.stringify(scenario.source)}`,
                    body(scope) {
                        const cache = createCoverageSourceCache();

                        for (const extension of [ 'ts', 'mts', 'cts' ]) {
                            scope.assert.equal(
                                cache.inspect(scenario.source, `source.${extension}`).hasRuntime,
                                scenario.runtime
                            );
                        }
                        return scope.assert.collect();
                    }
                });
            }),
        createTestCase({
            ...metadata,
            title: 'reuses source inspection only for the same file and content',
            body(scope) {
                const cache = createCoverageSourceCache();
                const source = 'export type Value = number;';
                const first = cache.inspect(source, 'source.ts');

                scope.assert.true(first === cache.inspect(source, 'source.ts'));
                scope.assert.false(first === cache.inspect(source, 'other.ts'));
                scope.assert.true(cache.inspect('export const value = 42;', 'source.ts').hasRuntime);
                scope.assert.false(first.hasRuntime);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'reads source-map directives only from comments',
            body(scope) {
                const cache = createCoverageSourceCache();
                const source = 'const value = "//# sourceMappingURL=missing.map";\n' +
                    '`//# sourceMappingURL=template.map`;\n' +
                    '/[/*]/;\n//# sourceMappingURL=actual.map\n/* block */';

                scope.assert.deepEqual(cache.inspect(source, 'source.js').comments, [
                    '//# sourceMappingURL=actual.map',
                    '/* block */'
                ]);
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
