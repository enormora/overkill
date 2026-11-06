import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { mapSourceRange, replaceMappedText, validateMappings, type TranslatedModule } from './generated-source.ts';

export const testNode = suite('generated source mapping', [
    test('composes length changes across CRLF and UTF-16 source ranges', function (scope: TestScope) {
        const text = '😀\r\nimport "./self.ts";\r\nexport {};';
        const module: TranslatedModule = {
            path: '/source.ts',
            originalText: text,
            text,
            mappings: [ {
                kind: 'copied',
                original: { start: 0, end: text.length },
                generated: { start: 0, end: text.length }
            } ]
        };
        const range = { start: text.indexOf('./self.ts'), end: text.indexOf('./self.ts') + './self.ts'.length };
        const repaired = replaceMappedText(module, range, './.overkill-type-test-self.ts');
        validateMappings(repaired);
        const generatedOffset = repaired.text.indexOf('export');
        scope.assert.deepEqual(
            mapSourceRange(repaired.mappings, { start: generatedOffset, end: generatedOffset + 6 }, 'generated'),
            [ {
                start: text.indexOf('export'),
                end: text.indexOf('export') + 6
            } ]
        );
        scope.assert.deepEqual(
            mapSourceRange(repaired.mappings, { start: range.start, end: range.start + 2 }, 'generated'),
            [ range ]
        );
        scope.assert.deepEqual(mapSourceRange(repaired.mappings, { start: 0, end: 2 }, 'original'), [ {
            start: 0,
            end: 2
        } ]);
        return scope.assert.collect();
    }),
    test('retains all generated copies of a source range', function (scope: TestScope) {
        scope.assert.deepEqual(
            mapSourceRange(
                [
                    { kind: 'copied', original: { start: 0, end: 2 }, generated: { start: 0, end: 2 } },
                    { kind: 'copied', original: { start: 0, end: 2 }, generated: { start: 4, end: 6 } }
                ],
                { start: 0, end: 2 },
                'original'
            ),
            [ { start: 0, end: 2 }, { start: 4, end: 6 } ]
        );
        return scope.assert.collect();
    }),
    test('rejects changed copied text', function (scope: TestScope) {
        scope.assert.throws(function invalidMapping() {
            validateMappings({
                path: '/source.ts',
                text: 'bad',
                originalText: 'yes',
                mappings: [
                    { kind: 'copied', original: { start: 0, end: 3 }, generated: { start: 0, end: 3 } }
                ]
            });
        }, { message: /Copied source mapping changed text/u });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
