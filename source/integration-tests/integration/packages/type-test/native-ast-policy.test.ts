import { type TestNode, table, suite, test } from '@overkill-dev/test';

import * as ast from 'typescript-beta/ast';
import { SymbolFlags } from 'typescript-beta/async';

import {
    rejectUnsupportedSite,
    sourceFixture,
    type SourceFixture,
    sourceSymbol as makeSymbol,
    sourceTree,
    sourceBody,
    sourceCall,
    sourceMember
} from '../../../../test-support/native-source-fixture.ts';
import {
    sourceChildren,
    sourceDeclarations,
    sourceSymbol,
    loadSourceSymbols,
    transparentExpression,
    immutableInitializer,
    validateFunctionBinding
} from '../../../../packages/type-test/source-analysis.ts';
import { declaredBody, namedBodyParameter } from '../../../../packages/type-test/source-ownership.ts';
import { scopeAssertions, assertionAnnotation } from '../../../../packages/type-test/scope-assertions.ts';
import { nativeReference } from '../../../../packages/type-test/native-reference.ts';

function aliasedFixture(): SourceFixture & { readonly node: ast.Identifier; } {
    const fixture = sourceFixture();
    const node = ast.factory.createIdentifier('value');
    sourceTree(ast.factory.createExpressionStatement(node));
    const alias = makeSymbol('alias', []);
    Reflect.set(alias, 'flags', SymbolFlags.Alias);
    const target = makeSymbol('target', []);
    fixture.bindSymbol(node, alias);
    fixture.bindAlias(alias, target);

    return { ...fixture, node };
}

export const testNode: TestNode = suite('isolated native syntax analysis', [
    test('retains declaration identity and filters unresolved handles', async function (scope) {
        const declaration = ast.factory.createVariableDeclaration(ast.factory.createIdentifier('value'));
        const symbol = makeSymbol('value', [ declaration ]);
        scope.assert.deepEqual(await sourceDeclarations(symbol), [ declaration ]);
        scope.assert.deepEqual(sourceChildren(declaration), [ declaration.name ]);
        return scope.assert.collect();
    }),
    test('caches symbol evidence and resolves aliases once', async function (scope) {
        const { node, ...fixture } = aliasedFixture();
        await loadSourceSymbols(fixture.analysis, [ node ]);
        fixture.forgetSymbol(node);
        const resolved = await sourceSymbol(fixture.analysis, node);
        scope.assert.equal(resolved?.name, 'target');
        await loadSourceSymbols(fixture.analysis, [ node ]);
        return scope.assert.collect();
    }),
    test('resolves shorthand values through their value symbol', async function (scope) {
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
        fixture.bindSymbol(name, symbol);
        await loadSourceSymbols(fixture.analysis, [ name ]);
        const resolved = await sourceSymbol(fixture.analysis, name);
        scope.assert.equal(resolved?.name, 'value');
        return scope.assert.collect();
    }),
    test('does not invent symbols for unresolved references', async function (scope) {
        const fixture = sourceFixture();
        const body = sourceBody([]);
        scope.assert.equal(await sourceSymbol(fixture.analysis, body), undefined);
        await scope.assert.rejects(async function () {
            await validateFunctionBinding(fixture.analysis, body);
        }, { message: /Cannot establish/u });
        return scope.assert.collect();
    }),
    test('unwraps transparent callback syntax and retains its body', async function (scope) {
        const fixture = sourceFixture();
        const body = sourceBody([]);
        const wrapped = ast.factory.createParenthesizedExpression(body);
        scope.assert.equal(transparentExpression(fixture.analysis, wrapped), body);
        scope.assert.equal(transparentExpression(fixture.analysis, body), undefined);
        scope.assert.equal(await declaredBody(fixture.analysis, wrapped), body);
        scope.assert.equal(namedBodyParameter(fixture.analysis, body), body.parameters.at(0)?.name);
        return scope.assert.collect();
    }),
    test('rejects non-function sources and unnamed scopes', async function (scope) {
        const { analysis } = sourceFixture();
        await scope.assert.rejects(async function () {
            await declaredBody(analysis, ast.factory.createStringLiteral('body', ast.TokenFlags.None));
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
    test('rejects identifiers with ambiguous or cyclic callback ownership', async function (scope) {
        const fixture = sourceFixture();
        const name = ast.factory.createIdentifier('body');
        sourceTree(ast.factory.createExpressionStatement(name));
        fixture.bindName('body', makeSymbol('body', []));
        await scope.assert.rejects(async function () {
            await declaredBody(fixture.analysis, name);
        }, { message: /ambiguous callback/u });
        return scope.assert.collect();
    }),
    test('collects direct assertions and leaves collection calls alone', async function (scope) {
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
        scope.assert.deepEqual(
            await scopeAssertions(
                fixture.analysis,
                body,
                parameter,
                rejectUnsupportedSite
            ),
            [ assertion ]
        );
        scope.assert.equal(await assertionAnnotation(fixture.analysis, assertion), null);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects runtime scope operations',
        cases: [ 'cleanup', 'require' ],
        caseTitle(operation) {
            return operation;
        },
        async test(scope) {
            const operation = scope.parameters;

            const fixture = sourceFixture();
            const call = sourceCall(sourceMember(ast.factory.createIdentifier('scope'), operation), []);
            const body = sourceBody([ ast.factory.createExpressionStatement(call) ]);
            await scope.assert.rejects(async function () {
                await scopeAssertions(
                    fixture.analysis,
                    body,
                    namedBodyParameter(fixture.analysis, body),
                    rejectUnsupportedSite
                );
            }, { message: /Unsupported runtime operation/u });
            return scope.assert.collect();
        }
    }),
    test('rejects detached assertions and forwarded scope arguments', async function (scope) {
        const fixture = sourceFixture();
        const detached = sourceMember(ast.factory.createIdentifier('scope'), 'assert');
        const body = sourceBody([ ast.factory.createExpressionStatement(detached) ]);
        await scope.assert.rejects(async function () {
            await scopeAssertions(
                fixture.analysis,
                body,
                namedBodyParameter(fixture.analysis, body),
                rejectUnsupportedSite
            );
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
            await scopeAssertions(
                fixture.analysis,
                forwarded,
                namedBodyParameter(fixture.analysis, forwarded),
                rejectUnsupportedSite
            );
        }, { message: /Scope forwarding/u });
        return scope.assert.collect();
    }),
    test('rejects nested assertions within operands and callbacks', async function (scope) {
        const fixture = sourceFixture();
        const nested = sourceCall(sourceMember(ast.factory.createIdentifier('scope'), 'assert'), []);
        const outer = sourceCall(sourceMember(ast.factory.createIdentifier('scope'), 'assert'), [
            ast.factory.createIdentifier('reference'),
            nested
        ]);
        const body = sourceBody([ ast.factory.createExpressionStatement(outer) ]);
        await scope.assert.rejects(async function () {
            await scopeAssertions(
                fixture.analysis,
                body,
                namedBodyParameter(fixture.analysis, body),
                rejectUnsupportedSite
            );
        }, { message: /Nested native assertion/u });
        return scope.assert.collect();
    }),
    test('rejects references that are not adapter exports', async function (scope) {
        const fixture = sourceFixture();
        const reference = sourceTree(sourceMember(ast.factory.createIdentifier('foreign'), 'expressions'));
        await scope.assert.rejects(async function () {
            await nativeReference(fixture.analysis, reference);
        }, { message: /not an adapter-owned/u });
        return scope.assert.collect();
    })
]);
