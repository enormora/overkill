import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import {
    mapSourceRange,
    replaceMappedSource,
    replaceMappedText,
    validateMappings,
    type TranslatedModule
} from './generated-source.ts';

function sourceModule(): TranslatedModule {
    return {
        path: '/example.ts',
        originalText: 'abc',
        text: 'abc',
        mappings: [ {
            kind: 'copied',
            original: { start: 0, end: 3 },
            generated: { start: 0, end: 3 }
        } ]
    };
}
export const testNode = suite('generated source range boundaries', [
    test('retains anchored provenance while replacing an adjacent copied range', function (scope: TestScope) {
        const first = replaceMappedText(sourceModule(), { start: 0, end: 1 }, 'alpha');
        const second = replaceMappedText(first, { start: 5, end: 7 }, 'bet');
        scope.assert.equal(second.text, 'alphabet');
        scope.assert.deepEqual(mapSourceRange(second.mappings, { start: 0, end: 5 }, 'generated'), [ {
            start: 0,
            end: 1
        } ]);
        return scope.assert.collect();
    }),
    ...[
        { start: Number.NaN, end: 1 },
        { start: 0, end: 1.5 },
        { start: -1, end: 1 },
        { start: 2, end: 1 },
        { start: 0, end: 4 }
    ]
        .map(function invalidRange(range, index) {
            return test(`rejects invalid replacement range ${index}`, function (scope: TestScope) {
                scope.assert.throws(function () {
                    replaceMappedSource(sourceModule(), range, []);
                }, { message: 'Invalid source range.' });
                return scope.assert.collect();
            });
        }),
    test('rejects discontinuous generated mappings', function (scope: TestScope) {
        const module = sourceModule();
        scope.assert.throws(function () {
            validateMappings({
                ...module,
                mappings: [ {
                    kind: 'anchored',
                    original: { start: 0, end: 3 },
                    generated: { start: 1, end: 3 }
                } ]
            });
        }, { message: 'Discontinuous mapping: /example.ts' });
        return scope.assert.collect();
    }),
    test('rejects incomplete generated mappings', function (scope: TestScope) {
        scope.assert.throws(function () {
            validateMappings({ ...sourceModule(), mappings: [] });
        }, { message: 'Incomplete source mapping: /example.ts' });
        return scope.assert.collect();
    }),
    test('rejects replacements without source provenance', function (scope: TestScope) {
        scope.assert.throws(function () {
            replaceMappedText({ ...sourceModule(), mappings: [] }, { start: 0, end: 1 }, 'x');
        }, { message: 'Unmapped import: /example.ts' });
        return scope.assert.collect();
    }),
    test('maps point locations and leaves outside points unmapped', function (scope: TestScope) {
        const { mappings } = sourceModule();
        scope.assert.deepEqual(mapSourceRange(mappings, { start: 1, end: 1 }, 'generated'), [ { start: 1, end: 1 } ]);
        scope.assert.deepEqual(mapSourceRange(mappings, { start: 4, end: 4 }, 'generated'), []);
        return scope.assert.collect();
    }),
    test('deletes source while retaining the untouched mapping', function (scope: TestScope) {
        const module = replaceMappedSource(sourceModule(), { start: 0, end: 1 }, [
            { kind: 'anchored', original: { start: 0, end: 1 }, text: '' }
        ]);
        scope.assert.equal(module.text, 'bc');
        scope.assert.deepEqual(module.mappings, [ {
            kind: 'copied',
            original: { start: 1, end: 3 },
            generated: { start: 0, end: 2 }
        } ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
