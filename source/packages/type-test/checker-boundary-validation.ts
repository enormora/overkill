import type TypeScript from 'typescript';
import { sourceSymbol, type SourceAnalysis } from './source-analysis.ts';

function isCheckerBoundary(analysis: SourceAnalysis, node: TypeScript.Identifier): boolean {
    const symbol = sourceSymbol(analysis, node);
    if (symbol === undefined || ![ 'expect', 'test', 'describe' ].includes(symbol.name)) {
        return false;
    }
    return symbol.declarations?.some(function checkerDeclaration(declaration) {
        return declaration.getSourceFile().fileName.replaceAll('\\', '/').includes('/node_modules/tstyche/');
    }) === true;
}

export function rejectForeignCheckerBoundaries(analysis: SourceAnalysis, file: TypeScript.SourceFile): void {
    function visit(node: TypeScript.Node): void {
        if (
            analysis.compiler.isIdentifier(node) && !analysis.compiler.isImportSpecifier(node.parent) &&
            isCheckerBoundary(analysis, node)
        ) {
            throw new Error('Checker assertion without native source ownership is unsupported.');
        }
        analysis.compiler.forEachChild(node, visit);
    }
    visit(file);
}
