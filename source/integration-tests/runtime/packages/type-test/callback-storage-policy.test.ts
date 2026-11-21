import { suite, test } from '@overkill-dev/test';

import * as ast from 'typescript-beta/ast';

import {
    sourceFixture,
    sourceConstant,
    type SourceFixture,
    sourceSymbol,
    sourceFile,
    sourceCall,
    sourceTree
} from '../../../../test-support/native-source-fixture.ts';

import { validateCallbackStorage, supportedCall } from '../../../../packages/type-test/source-options.ts';

function bindStorage(fixture: SourceFixture, statement: ast.VariableStatement): void {
    const declaration = statement.declarationList.declarations[0];
    if (declaration === undefined || !ast.isIdentifier(declaration.name)) {
        throw new Error('Expected a named storage binding.');
    }
    fixture.bindName(declaration.name.text, sourceSymbol(declaration.name.text, [ declaration ]));
}
function bindAuthoring(fixture: SourceFixture, call: ast.CallExpression, path: string): void {
    const declaration = ast.factory.createFunctionDeclaration(
        undefined,
        undefined,
        ast.factory.createIdentifier('test'),
        undefined,
        []
    );
    sourceFile([ declaration ], path);
    fixture.bindSignature(call, {
        declaration: {
            async resolve() {
                return declaration;
            }
        }
    });
}
function storageUse(
    exported: boolean
): SourceFixture & { readonly reference: ast.Identifier; readonly call: ast.CallExpression; } {
    const fixture = sourceFixture();
    const binding = sourceConstant('options', ast.factory.createObjectLiteralExpression([]), exported);
    const reference = ast.factory.createIdentifier('options');
    const call = sourceCall(ast.factory.createIdentifier('test'), [ reference ]);
    fixture.addFile(sourceFile([ binding, ast.factory.createExpressionStatement(call) ], '/project/case.ts'));
    bindStorage(fixture, binding);
    bindAuthoring(fixture, call, '/project/source/authoring/test.ts');
    return { ...fixture, reference, call };
}
function aliasedStorage(): SourceFixture & { readonly reference: ast.Identifier; readonly call: ast.CallExpression; } {
    const fixture = sourceFixture();
    const original = sourceConstant('options', ast.factory.createObjectLiteralExpression([]), false);
    const alias = sourceConstant('alias', ast.factory.createIdentifier('options'), false);
    const reference = ast.factory.createIdentifier('alias');
    const call = sourceCall(ast.factory.createIdentifier('test'), [ reference ]);
    fixture.addFile(sourceFile([ original, alias, ast.factory.createExpressionStatement(call) ], '/project/case.ts'));
    bindStorage(fixture, original);
    bindStorage(fixture, alias);
    bindAuthoring(fixture, call, '/project/source/authoring/test.ts');

    return { ...fixture, reference, call };
}
export const testNode = suite('callback storage ownership', [
    test('leaves unbound option literals unchanged', async function (scope) {
        const fixture = sourceFixture();
        const value = sourceTree(ast.factory.createObjectLiteralExpression([]));
        await validateCallbackStorage(fixture.analysis, value);
        scope.assert.equal(value.properties.length, 0);
        return scope.assert.collect();
    }),
    test('accepts constant options passed only to supported authoring APIs', async function (scope) {
        const fixture = storageUse(false);
        await validateCallbackStorage(fixture.analysis, fixture.reference);
        scope.assert.true(await supportedCall(fixture.analysis, fixture.call));
        return scope.assert.collect();
    }),
    test('rejects exported option storage', async function (scope) {
        const fixture = storageUse(true);
        await scope.assert.rejects(async function () {
            await validateCallbackStorage(fixture.analysis, fixture.reference);
        }, { message: /Exported callback options/u });
        return scope.assert.collect();
    }),
    test('rejects option storage passed to foreign declarations', async function (scope) {
        const fixture = storageUse(false);
        bindAuthoring(fixture, fixture.call, '/project/application.ts');
        await scope.assert.rejects(async function () {
            await validateCallbackStorage(fixture.analysis, fixture.reference);
        }, { message: /may be mutated or escape/u });
        scope.assert.false(await supportedCall(fixture.analysis, fixture.call));
        return scope.assert.collect();
    }),
    test('rejects authoring calls without declaration evidence', async function (scope) {
        const fixture = sourceFixture();
        scope.assert.false(await supportedCall(fixture.analysis, sourceCall(ast.factory.createIdentifier('test'), [])));
        return scope.assert.collect();
    }),
    test('rejects callback option values used as callable expressions', async function (scope) {
        const fixture = sourceFixture();
        const statement = sourceConstant('options', ast.factory.createObjectLiteralExpression([]), false);
        const reference = ast.factory.createIdentifier('options');
        fixture.addFile(
            sourceFile(
                [ statement, ast.factory.createExpressionStatement(sourceCall(reference, [])) ],
                '/project/case.ts'
            )
        );
        bindStorage(fixture, statement);
        await scope.assert.rejects(async function () {
            await validateCallbackStorage(fixture.analysis, reference);
        }, { message: /may be mutated or escape/u });
        return scope.assert.collect();
    }),
    test('tracks immutable aliases without treating their declarations as escapes', async function (scope) {
        const { reference, call, ...fixture } = aliasedStorage();
        await validateCallbackStorage(fixture.analysis, reference);
        scope.assert.true(await supportedCall(fixture.analysis, call));
        return scope.assert.collect();
    }),
    test('ignores unresolved references and transparent option literals', async function (scope) {
        const fixture = sourceFixture();
        const literal = sourceTree(
            ast.factory.createParenthesizedExpression(ast.factory.createObjectLiteralExpression([]))
        );
        await validateCallbackStorage(fixture.analysis, literal);
        const missing = ast.factory.createIdentifier('unknown');
        sourceTree(ast.factory.createExpressionStatement(missing));
        await validateCallbackStorage(fixture.analysis, missing);
        scope.assert.equal(fixture.analysis.compiler.isParenthesizedExpression(literal), true);
        return scope.assert.collect();
    })
]);
