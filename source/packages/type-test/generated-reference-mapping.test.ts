import * as TypeScript from 'typescript-beta/ast';
import { API } from 'typescript-beta/async';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { testNode as relations } from './relation-forms.test.ts';
import { testNode as lifetime } from './compiler-lifetime.test.ts';
import { createCompilerLifetime } from './compiler-lifetime.ts';
import { referenceExpression } from './native-reference-expression.ts';
import { replaceMappedSource, type TranslatedModule } from './generated-source.ts';

function referenceCall(node: TypeScript.Node): TypeScript.CallExpression | undefined {
    return TypeScript.isCallExpression(node) ? node : node.forEachChild(referenceCall);
}
async function translatedReference(originalText: string): Promise<TranslatedModule> {
    await using lifetime = createCompilerLifetime();
    return await lifetime.run(async function execute() {
        await using api = new API();
        await using lease = await api.createSourceFile('/example.ts', originalText);
        const file = lease.sourceFile;
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
        return replaceMappedSource(
            {
                path: file.fileName,
                originalText,
                text: originalText,
                mappings: [ { kind: 'copied', original: range, generated: range } ]
            },
            range,
            fragments
        );
    });
}
export const testNode = suite('native assertion source mapping', [
    relations,
    lifetime,
    test('preserves leading source trivia in translated type arguments', async function (scope: TestScope) {
        const translated = await translatedReference('reference<string, /* expected type */ number>()');
        scope.assert.equal(translated.text, 'check<string>().type.toBe< /* expected type */ number>()');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
