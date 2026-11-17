import type * as TypeScript from 'typescript-beta/ast';
import { sourceSymbol, sourceChildren, sourceDeclarations, type SourceAnalysis } from './source-analysis.ts';

async function isCheckerBoundary(analysis: SourceAnalysis, node: TypeScript.Identifier): Promise<boolean> {
    const symbol = await sourceSymbol(analysis, node);
    if (symbol === undefined || ![ 'expect', 'test', 'describe' ].includes(symbol.name)) {
        return false;
    }
    const declarations = await sourceDeclarations(symbol);
    return declarations.some(function checkerDeclaration(declaration) {
        return declaration.getSourceFile().fileName.replaceAll('\\', '/').includes('/node_modules/tstyche/');
    });
}

export async function rejectForeignCheckerBoundaries(
    analysis: SourceAnalysis,
    file: TypeScript.SourceFile
): Promise<void> {
    async function visit(node: TypeScript.Node): Promise<void> {
        if (
            analysis.compiler.isIdentifier(node) && !analysis.compiler.isImportSpecifier(node.parent) &&
            await isCheckerBoundary(analysis, node)
        ) {
            throw new Error('Checker assertion without native source ownership is unsupported.');
        }
        for (const child of sourceChildren(node)) {
            await visit(child);
        }
    }
    await visit(file);
}
