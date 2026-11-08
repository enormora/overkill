import TypeScript from 'typescript';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { referenceExpression } from './native-reference-expression.ts';
import {
    mapSourceRange,
    replaceMappedSource,
    replaceMappedText,
    validateMappings,
    type TranslatedModule
} from './generated-source.ts';

function referenceCall(node: TypeScript.Node): TypeScript.CallExpression | undefined {
    return TypeScript.isCallExpression(node) ? node : TypeScript.forEachChild(node, referenceCall);
}

export const testNode = suite('generated source mapping', [
    test('preserves leading source trivia in translated type arguments', function (scope: TestScope) {
        const originalText = 'reference<string, /* expected type */ number>()';
        const file = TypeScript.createSourceFile('/example.ts', originalText, TypeScript.ScriptTarget.Latest, true);
        const call = referenceCall(file);
        if (call === undefined) {
            throw new Error('Expected a reference call.');
        }
        const range = { start: 0, end: originalText.length };
        const fragments = referenceExpression(
            {
                kind: 'relation',
                matcher: 'toBe',
                form: 'typed',
                negated: false,
                types: call.typeArguments ?? []
            },
            [],
            'check',
            range
        );
        const translated = replaceMappedSource(
            {
                path: file.fileName,
                originalText,
                text: originalText,
                mappings: [ { kind: 'copied', original: range, generated: range } ]
            },
            range,
            fragments
        );
        scope.assert.equal(translated.text, 'check<string>().type.toBe< /* expected type */ number>()');
        return scope.assert.collect();
    }),
    test('excludes adjacent synthetic insertions from original token ranges', function (scope: TestScope) {
        const originalText = 'value';
        const module = replaceMappedText(
            {
                path: '/example.ts',
                originalText,
                text: originalText,
                mappings: [ { kind: 'copied', original: { start: 0, end: 5 }, generated: { start: 0, end: 5 } } ]
            },
            { start: 0, end: 0 },
            'prefix;'
        );
        scope.assert.deepEqual(mapSourceRange(module.mappings, { start: 0, end: 1 }, 'original'), [ {
            start: 7,
            end: 8
        } ]);
        return scope.assert.collect();
    }),
    test('maps copied operands precisely inside generated syntax', function (scope: TestScope) {
        const originalText = '😀\r\nvalue.missing';
        const start = originalText.indexOf('value');
        const module = replaceMappedSource(
            {
                path: '/example.ts',
                originalText,
                text: originalText,
                mappings: [ {
                    kind: 'copied',
                    original: { start: 0, end: originalText.length },
                    generated: { start: 0, end: originalText.length }
                } ]
            },
            { start, end: originalText.length },
            [
                { kind: 'anchored', original: { start, end: originalText.length }, text: 'check(' },
                { kind: 'copied', original: { start, end: originalText.length } },
                { kind: 'anchored', original: { start, end: originalText.length }, text: ')' }
            ]
        );
        validateMappings(module);
        const generated = module.text.indexOf('missing');
        scope.assert.deepEqual(mapSourceRange(module.mappings, { start: generated, end: generated + 7 }, 'generated'), [
            { start: originalText.indexOf('missing'), end: originalText.length }
        ]);
        return scope.assert.collect();
    }),
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
