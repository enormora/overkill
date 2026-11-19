import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { TraceMap, type SourceMapSegment } from '@jridgewell/trace-mapping';

import { normalizedSourceMap, validateSourceMapMappings } from './source-map-data.ts';

function mappedSource(segment: Readonly<SourceMapSegment>): TraceMap {
    return new TraceMap({
        version: 3,
        names: [ 'value' ],
        sources: [ 'source.ts' ],
        mappings: [ [ Array.from(segment) ] ]
    });
}
export const testNode = authoredSuite('source map coordinate validation', [
    ...([ [ -1, 0, 0, 0 ], [ 0, 1, 0, 0 ], [ 0, 0, 0, 0, 1 ] ] as const).map(function (segment, index) {
        return authoredTest(`rejects invalid mapping coordinate ${index}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                validateSourceMapMappings(mappedSource(segment), true);
            }, { message: 'Source map has no usable original mappings.' });
            return scope.assert.collect();
        });
    }),
    authoredTest('allows unmapped statements only when the source contains no runtime', function (scope: TestScope) {
        const map = mappedSource([ 0 ]);
        validateSourceMapMappings(map, false);
        scope.assert.throws(function () {
            validateSourceMapMappings(map, true);
        }, { message: 'Source map has no usable original mappings.' });
        return scope.assert.collect();
    }),
    authoredTest('preserves valid named mappings and supplies an empty ignore list', function (scope: TestScope) {
        const map = mappedSource([ 0, 0, 0, 0, 0 ]);
        validateSourceMapMappings(map, true);
        scope.assert.deepEqual(normalizedSourceMap(map, [ 'const value = 42;' ]), {
            version: 3,
            names: [ 'value' ],
            sources: [ 'source.ts' ],
            sourcesContent: [ 'const value = 42;' ],
            sourceRoot: '',
            mappings: 'AAAAA',
            ignoreList: []
        });
        return scope.assert.collect();
    })
]);
