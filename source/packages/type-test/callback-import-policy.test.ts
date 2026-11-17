import * as ast from 'typescript-beta/ast';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import {
    sourceFixture,
    sourceConstant,
    sourceSymbol,
    sourceFile,
    sourceCall
} from '../../test-support/native-source-fixture.ts';
import { bindAuthoringCall } from '../../test-support/callback-source.ts';
import { supportedCall, validateCallbackStorage } from './source-options.ts';

type ImportForm = 'default' | 'equals' | 'named' | 'namespace' | 'side-effect';
function importStatement(form: ImportForm): ast.Statement {
    const module = ast.factory.createStringLiteral('library', ast.TokenFlags.None);
    if (form === 'equals') {
        return ast.factory.createImportEqualsDeclaration(
            undefined,
            false,
            ast.factory.createIdentifier('library'),
            ast.factory.createExternalModuleReference(module)
        );
    }
    if (form === 'side-effect') {
        return ast.factory.createImportDeclaration(undefined, undefined, module);
    }
    const bindings = form === 'namespace'
        ? ast.factory.createNamespaceImport(ast.factory.createIdentifier('library'))
        : ast.factory.createNamedImports([
            ast.factory.createImportSpecifier(false, undefined, ast.factory.createIdentifier('imported'))
        ]);
    const clause = ast.factory.createImportClause(
        undefined,
        form === 'default' ? ast.factory.createIdentifier('defaultExport') : undefined,
        form === 'default' ? undefined : bindings
    );
    return ast.factory.createImportDeclaration(undefined, clause, module);
}
export const testNode = suite(
    'callback options alongside module imports',
    ([ 'default', 'equals', 'named', 'namespace', 'side-effect' ] as const).map(function importOwnership(form) {
        return test(`retains constant ownership beside ${form} imports`, async function (scope: TestScope) {
            const fixture = sourceFixture();
            const binding = sourceConstant('options', ast.factory.createObjectLiteralExpression([]), false);
            const reference = ast.factory.createIdentifier('options');
            const call = sourceCall(ast.factory.createIdentifier('test'), [
                ast.factory.createParenthesizedExpression(reference)
            ]);
            fixture.addFile(
                sourceFile([
                    importStatement(form),
                    binding,
                    ast.factory.createExpressionStatement(call)
                ], '/project/case.ts')
            );
            fixture.bindName('options', sourceSymbol('options', binding.declarationList.declarations));
            bindAuthoringCall(fixture, call, 'test', '/project/source/authoring/test.ts');
            await validateCallbackStorage(fixture.analysis, reference);
            scope.assert.true(await supportedCall(fixture.analysis, call));
            return scope.assert.collect();
        });
    })
);
await runIfMain(import.meta, testNode);
