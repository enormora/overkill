import { table, suite, test } from '@overkill-dev/test';

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
export const testNode = suite('source map coordinate validation', [
    table({
        title: 'rejects invalid mapping coordinate',
        cases: [ { description: 'negative generated column', input: [ -1, 0, 0, 0 ] }, {
            description: 'unknown source index',
            input: [ 0, 1, 0, 0 ]
        }, { description: 'unknown name index', input: [ 0, 0, 0, 0, 1 ] } ] as const,
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const segment = scope.parameters.input;

            scope.assert.throws(function () {
                validateSourceMapMappings(mappedSource(segment), true);
            }, { message: 'Source map has no usable original mappings.' });
            return scope.assert.collect();
        }
    }),
    test('allows unmapped statements only when the source contains no runtime', function (scope) {
        const map = mappedSource([ 0 ]);
        validateSourceMapMappings(map, false);
        scope.assert.throws(function () {
            validateSourceMapMappings(map, true);
        }, { message: 'Source map has no usable original mappings.' });
        return scope.assert.collect();
    }),
    test('preserves valid named mappings and supplies an empty ignore list', function (scope) {
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
