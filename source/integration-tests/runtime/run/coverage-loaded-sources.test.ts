import { table, suite, test } from '@overkill-dev/test';

import { fromObject } from 'convert-source-map';

import { memoryCoverageSources, coverageSourceMap } from '../../../test-support/coverage-source-memory.ts';
import { prepareLoadedCoverageSources } from '../../../run/coverage-loaded-sources.ts';

const source = 'export const value = 42;';
const compiledUrl = 'file:///project/compiled.js';
const sourcePath = '/project/source/value.ts';
function includeSource(): boolean {
    return true;
}

export const testNode = suite('loaded coverage source selection', [
    test('retains executable scripts and excludes TypeScript declarations', async function (scope) {
        const memory = memoryCoverageSources({
            '/project/runtime.ts': source,
            '/project/types.ts': 'export type Value = number;'
        });
        const result = await prepareLoadedCoverageSources({
            cache: memory.cache,
            projectRoot: '/project',
            includeSource,
            excludedFiles: new Set(),
            batches: [ {
                entries: [ { url: 'file:///project/runtime.ts' }, { url: 'file:///project/types.ts' } ],
                sourceMaps: {}
            } ]
        });
        scope.assert.deepEqual(Array.from(result.entries), [ 'file:///project/runtime.ts' ]);
        scope.assert.deepEqual(Array.from(result.sources), [ '/project/runtime.ts' ]);
        scope.assert.equal(result.maps.size, 0);
        return scope.assert.collect();
    }),
    test(
        'ignores sources outside the project and unsupported script locations',
        async function (scope) {
            const memory = memoryCoverageSources({});
            const urls = [
                'node:fs',
                'https://example.test/code.js',
                'file:///other/code.js',
                'file:///project/node_modules/dependency/code.js',
                'file:///project/image.png'
            ];
            const result = await prepareLoadedCoverageSources({
                cache: memory.cache,
                projectRoot: '/project',
                includeSource,
                excludedFiles: new Set(),
                batches: [ {
                    entries: urls.map(function entry(url) {
                        return { url };
                    }),
                    sourceMaps: {}
                } ]
            });
            scope.assert.deepEqual(Array.from(result.sources), []);
            scope.assert.deepEqual(memory.reads, []);
            return scope.assert.collect();
        }
    ),
    test('applies source selection to scripts without source maps', async function (scope) {
        const memory = memoryCoverageSources({ '/project/runtime.js': source });
        const result = await prepareLoadedCoverageSources({
            cache: memory.cache,
            projectRoot: '/project',
            includeSource: function rejectSource() {
                return false;
            },
            excludedFiles: new Set(),
            batches: [ { entries: [ { url: 'file:///project/runtime.js' } ], sourceMaps: {} } ]
        });
        scope.assert.deepEqual(Array.from(result.entries), []);
        return scope.assert.collect();
    }),
    test('deduplicates scripts across native coverage batches', async function (scope) {
        const memory = memoryCoverageSources({ '/project/runtime.js': source });
        const batch = { entries: [ { url: 'file:///project/runtime.js' } ], sourceMaps: {} };
        const result = await prepareLoadedCoverageSources({
            cache: memory.cache,
            projectRoot: '/project',
            includeSource,
            excludedFiles: new Set(),
            batches: [ batch, batch ]
        });
        scope.assert.deepEqual(Array.from(result.entries), [ 'file:///project/runtime.js' ]);
        scope.assert.deepEqual(Array.from(result.sources), [ '/project/runtime.js' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'resolves cached originals with embedded or missing content',
        cases: [ source, null ],
        caseTitle(content) {
            return content === null ? 'missing' : 'embedded';
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const memory = memoryCoverageSources({ '/project/compiled.js': source, [sourcePath]: source });
            const map = coverageSourceMap([ 'source/value.ts' ], [ scope.parameters ]);
            const result = await prepareLoadedCoverageSources({
                cache: memory.cache,
                projectRoot: '/project',
                includeSource,
                excludedFiles: new Set(),
                batches: [ { entries: [ { url: compiledUrl } ], sourceMaps: { [compiledUrl]: { data: map } } } ]
            });
            scope.assert.deepEqual(Array.from(result.sources), [ sourcePath ]);
            const resolved = result.maps.get(compiledUrl);
            require.defined(resolved);
            scope.assert.deepEqual(resolved, {
                ...map,
                sources: [ 'file:///project/source/value.ts' ],
                sourcesContent: [ source ]
            });
            scope.assert.equal(memory.reads.includes(sourcePath), scope.parameters === null);
            return scope.assert.collect();
        }
    }),
    test('prefers an inline source map over cached mappings', async function (scope) {
        const inline = coverageSourceMap([ 'source/value.ts' ], [ source ]);
        const memory = memoryCoverageSources({
            '/project/compiled.js': `${source}\n${fromObject(inline).toComment()}`
        });
        const result = await prepareLoadedCoverageSources({
            cache: memory.cache,
            projectRoot: '/project',
            includeSource,
            excludedFiles: new Set(),
            batches: [ {
                entries: [ { url: compiledUrl } ],
                sourceMaps: { [compiledUrl]: { data: coverageSourceMap([ 'wrong.ts' ], [ source ]) } }
            } ]
        });
        scope.assert.deepEqual(Array.from(result.sources), [ sourcePath ]);
        return scope.assert.collect();
    }),
    test('projects a test-file exclusion through an unambiguous source map', async function (scope) {
        const memory = memoryCoverageSources({ '/project/compiled.js': source });
        const map = coverageSourceMap([ 'source/value.ts' ], [ source ]);
        const result = await prepareLoadedCoverageSources({
            cache: memory.cache,
            projectRoot: '/project',
            includeSource,
            excludedFiles: new Set([ '/project/compiled.js' ]),
            batches: [ { entries: [ { url: compiledUrl } ], sourceMaps: { [compiledUrl]: { data: map } } } ]
        });
        scope.assert.deepEqual(Array.from(result.excludedFiles), [ '/project/compiled.js', sourcePath ]);
        scope.assert.deepEqual(Array.from(result.sources), []);
        return scope.assert.collect();
    }),
    test(
        'preserves distinct originals when an excluded container has multiple sources',
        async function (scope) {
            const memory = memoryCoverageSources({ '/project/compiled.js': source });
            const map = coverageSourceMap([ 'source/value.ts', 'source/other.ts' ], [ source, source ]);
            const result = await prepareLoadedCoverageSources({
                cache: memory.cache,
                projectRoot: '/project',
                includeSource,
                excludedFiles: new Set([ '/project/compiled.js' ]),
                batches: [ { entries: [ { url: compiledUrl } ], sourceMaps: { [compiledUrl]: { data: map } } } ]
            });
            scope.assert.deepEqual(Array.from(result.excludedFiles), [ '/project/compiled.js' ]);
            scope.assert.deepEqual(Array.from(result.sources), [ sourcePath, '/project/source/other.ts' ]);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'excludes non-executable originals',
        cases: [ 'webpack://virtual/value.ts', 'file:///project/source/types.ts', 'file:///project/source/value.txt' ],
        caseTitle(url) {
            return url;
        },
        async test(scope) {
            const url = scope.parameters;

            const memory = memoryCoverageSources({ '/project/compiled.js': source });
            const map = coverageSourceMap([ url ], [
                url.endsWith('types.ts')
                    ? 'export type Value = number;'
                    : source
            ]);
            const result = await prepareLoadedCoverageSources({
                cache: memory.cache,
                projectRoot: '/project',
                includeSource,
                excludedFiles: new Set(),
                batches: [ { entries: [ { url: compiledUrl } ], sourceMaps: { [compiledUrl]: { data: map } } } ]
            });
            scope.assert.deepEqual(Array.from(result.sources), []);
            scope.assert.equal(result.maps.size, 1);
            return scope.assert.collect();
        }
    }),
    test('does not read excluded originals without embedded content', async function (scope) {
        const memory = memoryCoverageSources({ '/project/compiled.js': source });
        const map = coverageSourceMap([ 'source/value.ts' ], [ null ]);
        const result = await prepareLoadedCoverageSources({
            cache: memory.cache,
            projectRoot: '/project',
            includeSource: function rejectOriginal() {
                return false;
            },
            excludedFiles: new Set(),
            batches: [ { entries: [ { url: compiledUrl } ], sourceMaps: { [compiledUrl]: { data: map } } } ]
        });
        scope.assert.deepEqual(Array.from(result.sources), []);
        scope.assert.deepEqual(memory.reads, [ '/project/compiled.js' ]);
        return scope.assert.collect();
    }),
    test('attributes invalid cached source maps to their generated script', async function (scope) {
        const memory = memoryCoverageSources({ '/project/compiled.js': source });
        await scope.assert.rejects(async function resolveInvalidMap() {
            return await prepareLoadedCoverageSources({
                cache: memory.cache,
                projectRoot: '/project',
                includeSource,
                excludedFiles: new Set(),
                batches: [ {
                    entries: [ { url: compiledUrl } ],
                    sourceMaps: { [compiledUrl]: { data: { version: 3, sources: [], mappings: '?' } } }
                } ]
            });
        }, { message: /Coverage source map failed for file:\/\/\/project\/compiled.js/u });
        return scope.assert.collect();
    })
]);
