import * as ast from 'typescript-beta/ast';
import { SymbolFlags } from 'typescript-beta/async';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import {
    sourceFixture,
    type SourceFixture,
    sourceSymbol as makeSymbol,
    sourceTree,
    sourceBody,
    sourceCall,
    sourceMember
} from '../../test-support/native-source-fixture.ts';
import {
    sourceChildren,
    sourceDeclarations,
    sourceSymbol,
    loadSourceSymbols,
    transparentExpression,
    immutableInitializer,
    validateFunctionBinding
} from './source-analysis.ts';
import { declaredBody, namedBodyParameter } from './source-ownership.ts';
import { scopeAssertions, assertionAnnotation } from './scope-assertions.ts';
import { nativeReference } from './native-reference.ts';
import { referenceExpression } from './native-reference-expression.ts';

function aliasedFixture(): SourceFixture & { readonly node: ast.Identifier; } {
    const fixture = sourceFixture();
    const node = ast.factory.createIdentifier('value');
    sourceTree(ast.factory.createExpressionStatement(node));
    const alias = makeSymbol('alias', []);
    Reflect.set(alias, 'flags', SymbolFlags.Alias);
    const target = makeSymbol('target', []);
    fixture.symbols.set(node, alias);
    fixture.aliases.set(alias, target);

    return { ...fixture, node };
}

export const testNode = suite('isolated native syntax analysis', [
    test('retains declaration identity and filters unresolved handles', async function (scope: TestScope) {
        const declaration = ast.factory.createVariableDeclaration(ast.factory.createIdentifier('value'));
        const symbol = makeSymbol('value', [ declaration ]);
        scope.assert.deepEqual(await sourceDeclarations(symbol), [ declaration ]);
        scope.assert.deepEqual(sourceChildren(declaration), [ declaration.name ]);
        return scope.assert.collect();
    }),
    test('caches symbol evidence and resolves aliases once', async function (scope: TestScope) {
        const { node, ...fixture } = aliasedFixture();
        await loadSourceSymbols(fixture.analysis, [ node ]);
        fixture.symbols.delete(node);
        scope.assert.equal((await sourceSymbol(fixture.analysis, node))?.name, 'target');
        await loadSourceSymbols(fixture.analysis, [ node ]);
        return scope.assert.collect();
    }),
    test('resolves shorthand values through their value symbol', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const name = ast.factory.createIdentifier('value');
        sourceTree(
            ast.factory.createShorthandPropertyAssignment(
                undefined,
                name,
                undefined,
                ast.factory.createKeywordTypeNode(
                    ast
                        .SyntaxKind
                        .UnknownKeyword
                )
            )
        );
        const symbol = makeSymbol('value', []);
        fixture.symbols.set(name, symbol);
        await loadSourceSymbols(fixture.analysis, [ name ]);
        scope.assert.equal((await sourceSymbol(fixture.analysis, name))?.name, 'value');
        return scope.assert.collect();
    }),
    test('does not invent symbols for unresolved references', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const body = sourceBody([]);
        scope.assert.equal(await sourceSymbol(fixture.analysis, body), undefined);
        await scope.assert.rejects(async function () {
            await validateFunctionBinding(fixture.analysis, body);
        }, { message: /Cannot establish/u });
        return scope.assert.collect();
    }),
    test('unwraps transparent callback syntax and retains its body', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const body = sourceBody([]);
        const wrapped = ast.factory.createParenthesizedExpression(body);
        scope.assert.equal(transparentExpression(fixture.analysis, wrapped), body);
        scope.assert.equal(transparentExpression(fixture.analysis, body), undefined);
        scope.assert.equal(await declaredBody(fixture.analysis, wrapped), body);
        scope.assert.equal(namedBodyParameter(fixture.analysis, body), body.parameters[0].name);
        return scope.assert.collect();
    }),
    test('rejects non-function sources and unnamed scopes', async function (scope: TestScope) {
        const { analysis } = sourceFixture();
        await scope.assert.rejects(async function () {
            await declaredBody(analysis, ast.factory.createStringLiteral('body'));
        }, { message: /not a statically identifiable/u });
        const body = ast.factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            ast.factory.createToken(ast.SyntaxKind.EqualsGreaterThanToken),
            ast.factory.createBlock([])
        );
        scope.assert.throws(function () {
            namedBodyParameter(analysis, body);
        }, { message: /named first/u });
        scope.assert.equal(immutableInitializer(analysis, body), undefined);
        return scope.assert.collect();
    }),
    test('rejects identifiers with ambiguous or cyclic callback ownership', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const name = ast.factory.createIdentifier('body');
        sourceTree(ast.factory.createExpressionStatement(name));
        fixture.names.set('body', makeSymbol('body', []));
        await scope.assert.rejects(async function () {
            await declaredBody(fixture.analysis, name);
        }, { message: /ambiguous callback/u });
        return scope.assert.collect();
    }),
    test('collects direct assertions and leaves collection calls alone', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const assertion = sourceCall(sourceMember(ast.factory.createIdentifier('scope'), 'assert'), []);
        const collect = sourceCall(
            sourceMember(sourceMember(ast.factory.createIdentifier('scope'), 'assert'), 'collect'),
            []
        );
        const body = sourceBody([
            ast.factory.createExpressionStatement(assertion),
            ast.factory.createExpressionStatement(collect)
        ]);
        const parameter = namedBodyParameter(fixture.analysis, body);
        scope.assert.deepEqual(await scopeAssertions(fixture.analysis, body, parameter), [ assertion ]);
        scope.assert.equal(await assertionAnnotation(fixture.analysis, assertion), null);
        return scope.assert.collect();
    }),
    ...[ 'cleanup', 'require' ].map(function (operation) {
        return test(`rejects runtime scope operation ${operation}`, async function (scope: TestScope) {
            const fixture = sourceFixture();
            const call = sourceCall(sourceMember(ast.factory.createIdentifier('scope'), operation), []);
            const body = sourceBody([ ast.factory.createExpressionStatement(call) ]);
            await scope.assert.rejects(async function () {
                await scopeAssertions(fixture.analysis, body, namedBodyParameter(fixture.analysis, body));
            }, { message: /Unsupported runtime operation/u });
            return scope.assert.collect();
        });
    }),
    test('rejects detached assertions and forwarded scope arguments', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const detached = sourceMember(ast.factory.createIdentifier('scope'), 'assert');
        const body = sourceBody([ ast.factory.createExpressionStatement(detached) ]);
        await scope.assert.rejects(async function () {
            await scopeAssertions(fixture.analysis, body, namedBodyParameter(fixture.analysis, body));
        }, { message: /Detached assertion/u });
        const forwarded = sourceBody([
            ast.factory.createExpressionStatement(sourceCall(
                ast
                    .factory
                    .createIdentifier('forward'),
                [ ast.factory.createIdentifier('scope') ]
            ))
        ]);
        await scope.assert.rejects(async function () {
            await scopeAssertions(fixture.analysis, forwarded, namedBodyParameter(fixture.analysis, forwarded));
        }, { message: /Scope forwarding/u });
        return scope.assert.collect();
    }),
    test('rejects nested assertions within operands and callbacks', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const nested = sourceCall(sourceMember(ast.factory.createIdentifier('scope'), 'assert'), []);
        const outer = sourceCall(sourceMember(ast.factory.createIdentifier('scope'), 'assert'), [
            ast.factory.createIdentifier('reference'),
            nested
        ]);
        const body = sourceBody([ ast.factory.createExpressionStatement(outer) ]);
        await scope.assert.rejects(async function () {
            await scopeAssertions(fixture.analysis, body, namedBodyParameter(fixture.analysis, body));
        }, { message: /Nested native assertion/u });
        return scope.assert.collect();
    }),
    test('rejects references that are not adapter exports', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const reference = sourceTree(sourceMember(ast.factory.createIdentifier('foreign'), 'expressions'));
        await scope.assert.rejects(async function () {
            await nativeReference(fixture.analysis, reference);
        }, { message: /not an adapter-owned/u });
        return scope.assert.collect();
    }),
    test('renders expression relations with precise operand ownership', function (scope: TestScope) {
        const first = ast.factory.createIdentifier('actual');
        const second = ast.factory.createIdentifier('expected');
        Reflect.set(first, 'pos', 1);
        Reflect.set(first, 'end', 7);
        Reflect.set(second, 'pos', 8);
        Reflect.set(second, 'end', 16);
        const fragments = referenceExpression(
            { kind: 'relation', matcher: 'toBe', form: 'expressions', negated: true, types: [] },
            [ first, second ],
            'check',
            { start: 0, end: 20 }
        );
        scope.assert.deepEqual(
            fragments.filter(function (fragment) {
                return fragment.kind === 'copied';
            }),
            [
                { kind: 'copied', original: { start: 1, end: 7 } },
                { kind: 'copied', original: { start: 8, end: 16 } }
            ]
        );
        scope.assert.includes(
            fragments
                .map(function (fragment) {
                    return fragment.kind === 'anchored' ? fragment.text : '';
                })
                .join(''),
            '.type.not.toBe'
        );
        return scope.assert.collect();
    }),
    test('rejects missing relation operands', function (scope: TestScope) {
        scope.assert.throws(function () {
            referenceExpression(
                { kind: 'relation', matcher: 'toBe', form: 'typed', negated: false, types: [] },
                [],
                'check',
                { start: 0, end: 1 }
            );
        }, { message: /missing an operand/u });
        scope.assert.throws(function () {
            referenceExpression(
                { kind: 'relation', matcher: 'toBe', form: 'expressions', negated: false, types: [] },
                [],
                'check',
                { start: 0, end: 1 }
            );
        }, { message: /operand count/u });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
