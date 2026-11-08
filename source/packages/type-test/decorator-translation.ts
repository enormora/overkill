import type TypeScript from 'typescript';
import { sourceSymbol, type SourceAnalysis } from './source-analysis.ts';
import { namedBodyParameter } from './source-ownership.ts';
import type { NativeReference } from './native-reference.ts';
import type { SourceRange, SourceFragment } from './generated-source.ts';

export type SourceReplacement = { readonly range: SourceRange; readonly fragments: readonly SourceFragment[]; };

type DecoratorBinding = { readonly parameter: TypeScript.Identifier; readonly symbol: TypeScript.Symbol; };
function decoratorParameter(analysis: SourceAnalysis, declaration: TypeScript.Expression): DecoratorBinding {
    const { compiler } = analysis;
    if (!compiler.isArrowFunction(declaration) && !compiler.isFunctionExpression(declaration)) {
        throw new Error('Decorator assertions require an inline declaration callback.');
    }
    const parameter = namedBodyParameter(analysis, declaration);
    const symbol = analysis.checker.getSymbolAtLocation(parameter);
    if (symbol === undefined) {
        throw new Error('Cannot resolve the decorator declaration parameter.');
    }
    return { parameter, symbol };
}

function directDecoratorUse(analysis: SourceAnalysis, node: TypeScript.Node): boolean {
    const { compiler } = analysis;
    const { parent } = node;
    return compiler.isDecorator(parent) && parent.expression === node ||
        compiler.isTypeQueryNode(parent) || compiler.isQualifiedName(parent);
}

function rejectDecoratorForwarding(analysis: SourceAnalysis, node: TypeScript.Node, binding: DecoratorBinding): void {
    if (!analysis.compiler.isIdentifier(node) || node === binding.parameter) {
        return;
    }
    if (sourceSymbol(analysis, node) === binding.symbol && !directDecoratorUse(analysis, node)) {
        throw new Error('Decorator parameter forwarding is unsupported.');
    }
}

export function decoratorReplacements(
    analysis: SourceAnalysis,
    declaration: TypeScript.Expression,
    reference: NativeReference,
    expectName: string
): readonly SourceReplacement[] {
    const { compiler, checker } = analysis;
    const { parameter, symbol } = decoratorParameter(analysis, declaration);
    const replacements: SourceReplacement[] = [];
    function visit(node: TypeScript.Node): void {
        rejectDecoratorForwarding(analysis, node, { parameter, symbol });
        if (compiler.isDecorator(node) && checker.getSymbolAtLocation(node.expression) === symbol) {
            const { expression } = node;
            replacements.push({
                range: { start: expression.getStart(), end: expression.end },
                fragments: [
                    { kind: 'anchored', original: { start: node.getStart(), end: node.end }, text: `(${expectName}(` },
                    { kind: 'copied', original: { start: expression.getStart(), end: expression.end } },
                    {
                        kind: 'anchored',
                        original: { start: node.getStart(), end: node.end },
                        text: `).type.${reference.negated ? 'not.' : ''}toBeApplicable)`
                    }
                ]
            });
        }
        compiler.forEachChild(node, visit);
    }
    compiler.forEachChild(declaration, visit);
    if (replacements.length === 0) {
        throw new Error('Decorator declaration callback has no supported decorator sites.');
    }
    return replacements;
}
