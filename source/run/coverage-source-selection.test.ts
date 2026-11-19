import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import type { V8CoverageEntry } from 'monocart-coverage-reports';

import { memoryCoverageAccess, coverageSourceMap } from '../test-support/coverage-source-memory.ts';
import { prepareCoverageSources, type CoverageSourceScope } from './coverage-source-selection.ts';

const source = 'export const value: number = 42;';
const scriptUrl = 'file:///project/source/value.ts';
const input = { projectRoot: '/project', rawDataDirectory: '/project/raw' };
const loadedScope: CoverageSourceScope = {
    mode: 'loaded',
    exclude: [ '**/*.test.ts' ],
    excludedFiles: new Set([ '/project/test.ts' ])
};
const files = {
    '/project/source/value.ts': source,
    '/project/source/types.ts': 'export type Value = number;',
    '/project/source/other.js': 'export const other = 1;',
    '/project/source/image.png': 'ignored',
    '/project/source/case.test.ts': 'export const test = 1;',
    '/project/node_modules/dependency.ts': source,
    '/outside/value.ts': source
};
const batches = [ { entries: [ { url: scriptUrl } ], sourceMaps: {} } ];

export const testNode = authoredSuite('coverage source policy', [
    authoredTest('loaded mode retains only eligible loaded sources', async function (scope: TestScope) {
        const selected = await prepareCoverageSources(
            { ...input, sourceScope: loadedScope },
            memoryCoverageAccess(files, batches)
        );
        scope.assert.equal(selected.all, null);
        scope.assert.true(selected.entryIncluded({ url: scriptUrl }));
        scope.assert.false(selected.entryIncluded({ url: 'file:///project/source/other.js' }));
        scope.assert.true(selected.sourceIncluded('source/value.ts'));
        scope.assert.false(selected.sourceIncluded('source/other.js'));
        scope.assert.deepEqual(selected.batches, batches);
        return scope.assert.collect();
    }),
    authoredTest(
        'all mode includes unloaded runtime sources and filters generated input',
        async function (scope: TestScope) {
            const sourceScope: CoverageSourceScope = {
                ...loadedScope,
                mode: 'all',
                include: [ 'source/**/*.ts', 'source/**/*.js' ]
            };
            const selected = await prepareCoverageSources(
                { ...input, sourceScope },
                memoryCoverageAccess(files, batches)
            );
            const { all } = selected;
            scope.require.defined(all);
            scope.assert.deepEqual(Object.keys(files).filter(selected.sourceIncluded), [
                '/project/source/value.ts',
                '/project/source/other.js'
            ]);
            scope.assert.deepEqual(Object.keys(files).filter(all.filter), [
                '/project/source/value.ts',
                '/project/source/other.js'
            ]);
            scope.assert.equal(all.dir, '/project');
            return scope.assert.collect();
        }
    ),
    authoredTest('honors exact test-file exclusions independently of patterns', async function (scope: TestScope) {
        const sourceScope: CoverageSourceScope = {
            mode: 'all',
            include: [ 'source/**/*.ts' ],
            exclude: [],
            excludedFiles: new Set([ '/project/source/value.ts' ])
        };
        const selected = await prepareCoverageSources({ ...input, sourceScope }, memoryCoverageAccess(files, batches));
        scope.assert.false(selected.entryIncluded({ url: scriptUrl }));
        scope.assert.false(selected.sourceIncluded('source/value.ts'));
        scope.assert.true(selected.sourceIncluded('source/case.test.ts'));
        return scope.assert.collect();
    }),
    authoredTest('normalizes native TypeScript entries without changing V8 offsets', async function (scope: TestScope) {
        const selected = await prepareCoverageSources(
            { ...input, sourceScope: loadedScope },
            memoryCoverageAccess(files, batches)
        );
        const entry: V8CoverageEntry = {
            url: scriptUrl,
            functions: [ {
                functionName: '',
                isBlockCoverage: true,
                ranges: [ { startOffset: 0, endOffset: source.length, count: 1 } ]
            } ]
        };
        await selected.onEntry(entry);
        scope.require.defined(entry.source);
        scope.assert.equal(entry.source.length, source.length);
        scope.assert.false(entry.source.includes(': number'));
        scope.assert.includes(entry.source, 'export const value');
        scope.assert.equal(Reflect.get(entry, 'fake'), false);
        return scope.assert.collect();
    }),
    authoredTest('keeps JavaScript entry content intact', async function (scope: TestScope) {
        const selected = await prepareCoverageSources(
            { ...input, sourceScope: loadedScope },
            memoryCoverageAccess(files, [ { entries: [ { url: 'file:///project/source/other.js' } ], sourceMaps: {} } ])
        );
        const entry: V8CoverageEntry = { url: 'file:///project/source/other.js', source: 'already provided' };
        await selected.onEntry(entry);
        scope.assert.equal(entry.source, 'already provided');
        return scope.assert.collect();
    }),
    authoredTest('attaches resolved source maps to generated containers', async function (scope: TestScope) {
        const map = coverageSourceMap([ 'source/value.ts' ], [ source ]);
        const access = memoryCoverageAccess({ ...files, '/project/compiled.js': 'export const value = 42;' }, [ {
            entries: [ { url: 'file:///project/compiled.js' } ],
            sourceMaps: { 'file:///project/compiled.js': { data: map } }
        } ]);
        const selected = await prepareCoverageSources({ ...input, sourceScope: loadedScope }, access);
        const entry: V8CoverageEntry = { url: 'file:///project/compiled.js' };
        await selected.onEntry(entry);
        scope.assert.deepEqual<unknown, unknown>(Reflect.get(entry, 'sourceMap'), {
            ...map,
            sources: [ 'file:///project/source/value.ts' ]
        });
        scope.assert.true(selected.sourceIncluded('source/value.ts'));
        return scope.assert.collect();
    }),
    authoredTest('uses original source URLs for portable report paths', async function (scope: TestScope) {
        const selected = await prepareCoverageSources(
            { ...input, sourceScope: loadedScope },
            memoryCoverageAccess(files, batches)
        );
        scope.assert.equal(selected.sourcePath('generated', { url: scriptUrl }), 'source/value.ts');
        scope.assert.equal(selected.sourcePath('unchanged', { url: 'webpack://virtual/value.ts' }), 'unchanged');
        scope.assert.equal(selected.sourcePath('unchanged', {}), 'unchanged');
        return scope.assert.collect();
    }),
    authoredTest('strips types from unloaded TypeScript sources before reporting', async function (scope: TestScope) {
        const sourceScope: CoverageSourceScope = { ...loadedScope, mode: 'all', include: [ 'source/**/*.ts' ] };
        const selected = await prepareCoverageSources({ ...input, sourceScope }, memoryCoverageAccess(files, []));
        const { all } = selected;
        scope.require.defined(all);
        const entry = { url: scriptUrl, source };
        await all.transformer(entry);
        scope.assert.false(entry.source.includes(': number'));
        scope.assert.equal(entry.source.length, source.length);
        return scope.assert.collect();
    }),
    authoredTest('does not transform unloaded JavaScript content', async function (scope: TestScope) {
        const sourceScope: CoverageSourceScope = { ...loadedScope, mode: 'all', include: [ 'source/**/*.js' ] };
        const selected = await prepareCoverageSources({ ...input, sourceScope }, memoryCoverageAccess(files, []));
        const { all } = selected;
        scope.require.defined(all);
        const entry = { url: 'file:///project/source/other.js', source: 'export const other = 1;' };
        await all.transformer(entry);
        scope.assert.equal(entry.source, 'export const other = 1;');
        return scope.assert.collect();
    })
]);
