import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import * as ast from 'typescript-beta/ast';
import { SymbolFlags } from 'typescript-beta/async';

import {
    sourceFixture,
    type SourceFixture,
    sourceFile,
    sourceTree,
    sourceSymbol,
    sourceBody
} from '../../../../test-support/native-source-fixture.ts';

import {
    sourceSymbol as analyzedSymbol,
    sourceDeclarations,
    originalSourceFile,
    transparentExpression,
    immutableInitializer,
    validateFunctionBinding,
    loadSourceSymbols
} from '../../../../packages/type-test/source-analysis.ts';
import {
    isSourceNode,
    createSourceAnalysis,
    type AnalyzedSymbol
} from '../../../../packages/type-test/source-analysis-port.ts';
import { namedBodyParameter } from '../../../../packages/type-test/source-ownership.ts';

function incompleteSymbols(node: ast.Node): Promise<undefined>;
function incompleteSymbols(nodes: readonly ast.Node[]): Promise<readonly undefined[]>;
async function incompleteSymbols(input: ast.Node | readonly ast.Node[]): Promise<readonly undefined[] | undefined> {
    return isSourceNode(input) ? undefined : [];
}
type BindingUse = 'assign' | 'compare' | 'read' | 'type';
function bindingStatement(reference: ast.Identifier, use: BindingUse): ast.Statement {
    if (use === 'type') {
        return ast.factory.createTypeAliasDeclaration(
            undefined,
            ast.factory.createIdentifier('Callback'),
            undefined,
            ast.factory.createTypeQueryNode(reference)
        );
    }
    const value = use === 'read'
        ? reference
        : ast.factory.createBinaryExpression(
            undefined,
            reference,
            undefined,
            ast.factory.createToken(
                use === 'assign'
                    ? ast
                        .SyntaxKind
                        .EqualsToken
                    : ast.SyntaxKind.EqualsEqualsEqualsToken
            ),
            ast.factory.createIdentifier('replacement')
        );
    return ast.factory.createExpressionStatement(value);
}
function functionBinding(use: BindingUse): SourceFixture & { readonly name: ast.Identifier; } {
    const fixture = sourceFixture();
    const name = ast.factory.createIdentifier('callback');
    const declaration = ast.factory.createFunctionDeclaration(
        undefined,
        undefined,
        name,
        undefined,
        [],
        undefined,
        ast.factory.createBlock([])
    );
    const reference = ast.factory.createIdentifier('callback');
    Reflect.set(reference, 'pos', 1);
    Reflect.set(reference, 'end', 2);
    fixture.addFile(sourceFile([ declaration, bindingStatement(reference, use) ], '/project/case.ts'));
    fixture.bindName('callback', sourceSymbol('callback', [ declaration ]));
    return { ...fixture, name };
}

export const testNode: TestNode = suite('source analysis evidence', [
    table({
        title: 'allows non-mutating function references',
        cases: [ 'compare', 'type' ] as const,
        caseTitle(use) {
            return use;
        },
        async test(scope) {
            const use = scope.parameters;

            const fixture = functionBinding(use);
            await validateFunctionBinding(fixture.analysis, fixture.name);
            const symbol = await analyzedSymbol(fixture.analysis, fixture.name);
            scope.assert.equal(symbol?.name, 'callback');
            return scope.assert.collect();
        }
    }),
    test('preserves symbol identity across analyses of the same program', async function (scope: TestScope) {
        const fixture = sourceFixture();
        fixture.bindName('shared', sourceSymbol('shared', []));
        const nodes = [ ast.factory.createIdentifier('shared'), ast.factory.createIdentifier('shared') ] as const;
        sourceTree(ast.factory.createBlock(nodes.map(function (node) {
            return ast.factory.createExpressionStatement(node);
        })));
        const input = {
            ...fixture.analysis,
            checker: {
                ...fixture
                    .analysis
                    .checker,
                async getAliasedSymbol(symbol: AnalyzedSymbol) {
                    return symbol.alias();
                }
            }
        };
        const first = await analyzedSymbol(createSourceAnalysis(input), nodes[0]);
        const second = await analyzedSymbol(createSourceAnalysis(input), nodes[1]);
        scope.require.defined(first);
        scope.assert.equal(first, second);
        return scope.assert.collect();
    }),
    test(
        'recovers canonical source identities without accessing the filesystem',
        async function (scope) {
            const fixture = sourceFixture();
            const file = sourceFile([], '/project/case.ts');
            fixture.addFile(file);
            fixture.bindCanonicalPath('/alias/case.ts', file.fileName);
            scope.assert.equal(await originalSourceFile(fixture.analysis, '/alias/case.ts'), file);
            return scope.assert.collect();
        }
    ),
    test('rejects ambiguous canonical source identities', async function (scope) {
        const fixture = sourceFixture();
        fixture.addFile(sourceFile([], '/project/one.ts'));
        fixture.addFile(sourceFile([], '/project/two.ts'));
        fixture.bindCanonicalPath('/project/one.ts', '/canonical/case.ts');
        fixture.bindCanonicalPath('/project/two.ts', '/canonical/case.ts');
        await scope.assert.rejects(async function () {
            return originalSourceFile(fixture.analysis, '/canonical/case.ts');
        }, { message: /ambiguous project identities/u });
        return scope.assert.collect();
    }),
    test('retains missing source evidence instead of inventing an input', async function (scope) {
        const fixture = sourceFixture();
        scope.assert.equal(await originalSourceFile(fixture.analysis, '/missing.ts'), undefined);
        return scope.assert.collect();
    }),
    test('filters declarations that the compiler cannot resolve', async function (scope) {
        const declaration = ast.factory.createVariableDeclaration(ast.factory.createIdentifier('value'));
        const result = await sourceDeclarations({
            declarations: [ {
                async resolve() {
                    return undefined;
                }
            }, {
                async resolve() {
                    return declaration;
                }
            } ]
        });
        scope.assert.deepEqual(result, [ declaration ]);
        return scope.assert.collect();
    }),
    test('rejects incomplete batched compiler symbol evidence', async function (scope) {
        const fixture = sourceFixture();
        const node = ast.factory.createIdentifier('value');
        sourceTree(ast.factory.createExpressionStatement(node));
        const analysis = {
            ...fixture.analysis,
            checker: { ...fixture.analysis.checker, getSymbolAtLocation: incompleteSymbols }
        };
        await scope.assert.rejects(async function () {
            await loadSourceSymbols(analysis, [ node ]);
        }, { message: /Incomplete compiler symbol evidence/u });
        return scope.assert.collect();
    }),
    test('retains unresolved aliases as missing evidence', async function (scope) {
        const fixture = sourceFixture();
        const node = ast.factory.createIdentifier('alias');
        sourceTree(ast.factory.createExpressionStatement(node));
        fixture.bindName('alias', { ...sourceSymbol('alias', []), flags: SymbolFlags.Alias });
        scope.assert.equal(await analyzedSymbol(fixture.analysis, node), undefined);
        return scope.assert.collect();
    }),
    test('allows stable function declarations', async function (scope) {
        const fixture = functionBinding('read');
        await validateFunctionBinding(fixture.analysis, fixture.name);
        const symbol = await analyzedSymbol(fixture.analysis, fixture.name);
        scope.assert.equal(symbol?.name, 'callback');
        return scope.assert.collect();
    }),
    test('rejects reassigned function bindings', async function (scope) {
        const fixture = functionBinding('assign');
        await scope.assert.rejects(async function () {
            await validateFunctionBinding(fixture.analysis, fixture.name);
        }, { message: /cannot be reassigned/u });
        return scope.assert.collect();
    }),
    test('unwraps all supported type-only expression wrappers', function (scope) {
        const { analysis } = sourceFixture();
        const value = ast.factory.createIdentifier('value');
        const type = ast.factory.createKeywordTypeNode(ast.SyntaxKind.UnknownKeyword);
        const wrappers = [
            ast.factory.createAsExpression(value, type),
            ast.factory.createSatisfiesExpression(value, type),
            ast.factory.createTypeAssertion(type, value),
            ast.factory.createExpressionWithTypeArguments(value, []),
            ast.factory.createParenthesizedExpression(value)
        ];
        for (const wrapper of wrappers) {
            scope.assert.equal(transparentExpression(analysis, wrapper), value);
        }
        return scope.assert.collect();
    }),
    test('recognizes only immutable variable initializers', function (scope) {
        const { analysis } = sourceFixture();
        const value = ast.factory.createStringLiteral('value', ast.TokenFlags.None);
        const declaration = ast.factory.createVariableDeclaration(
            ast.factory.createIdentifier('options'),
            undefined,
            undefined,
            value
        );
        const declarations = ast.factory.createVariableDeclarationList([ declaration ], ast.NodeFlags.Const);
        sourceTree(declarations);
        Reflect.set(declarations, 'getFirstToken', function keyword() {
            return ast.factory.createToken(ast.SyntaxKind.ConstKeyword);
        });
        scope.assert.equal(immutableInitializer(analysis, declaration), value);
        Reflect.set(declarations, 'getFirstToken', function keyword() {
            return ast.factory.createToken(ast.SyntaxKind.LetKeyword);
        });
        scope.assert.equal(immutableInitializer(analysis, declaration), undefined);
        return scope.assert.collect();
    }),
    test('rejects destructured checker scope parameters', function (scope) {
        const { analysis } = sourceFixture();
        const body = sourceBody([]);
        const parameter = ast.factory.createParameterDeclaration(
            undefined,
            undefined,
            ast.factory.createObjectBindingPattern([])
        );
        const changed = ast.factory.updateArrowFunction(
            body,
            undefined,
            undefined,
            [ parameter ],
            undefined,
            body.equalsGreaterThanToken,
            body.body
        );
        scope.assert.throws(function () {
            namedBodyParameter(analysis, changed);
        }, { message: /named first callback parameter/u });
        return scope.assert.collect();
    })
]);
