import type * as TypeScript from 'typescript-beta/ast';
import type { SourceFragment, SourceRange } from './generated-source.ts';
import type { NativeReference } from './native-reference.ts';

type ExpressionContext = {
    readonly reference: NativeReference;
    readonly operands: readonly TypeScript.Expression[];
    readonly expectName: string;
    readonly anchor: SourceRange;
};

function syntax(context: ExpressionContext, text: string): SourceFragment {
    return { kind: 'anchored', original: context.anchor, text };
}

function copied(node: TypeScript.Node | undefined): SourceFragment {
    if (node === undefined) {
        throw new Error('Native assertion is missing an operand.');
    }
    return { kind: 'copied', original: { start: node.getFullStart(), end: node.end } };
}

function subject(context: ExpressionContext): readonly SourceFragment[] {
    const { reference, operands, expectName } = context;
    if (reference.form === 'withActual' || reference.form === 'expressions') {
        return [ syntax(context, `${expectName}(`), copied(operands[0]), syntax(context, ')') ];
    }
    return [ syntax(context, `${expectName}<`), copied(reference.types[0]), syntax(context, '>()') ];
}

function validateOperandCount(context: ExpressionContext): void {
    const { reference, operands } = context;
    const counts = { typed: 0, withActual: 1, withExpected: 1, expressions: 2 };
    if (operands.length !== counts[reference.form]) {
        throw new Error('Invalid native relation operand count.');
    }
}

function target(context: ExpressionContext): readonly SourceFragment[] {
    const { reference, operands } = context;
    if (reference.form === 'typed' || reference.form === 'withActual') {
        return [
            syntax(context, '<'),
            copied(reference.types[reference.form === 'typed' ? 1 : 0]),
            syntax(context, '>()')
        ];
    }
    const start = reference.form === 'expressions' ? 1 : 0;
    return [
        syntax(context, '('),
        ...operands.slice(start).flatMap(function operand(node, index) {
            return index === 0 ? [ copied(node) ] : [ syntax(context, ', '), copied(node) ];
        }),
        syntax(context, ')')
    ];
}

export function referenceExpression(
    reference: NativeReference,
    operands: readonly TypeScript.Expression[],
    expectName: string,
    anchor: SourceRange
): readonly SourceFragment[] {
    const context = { reference, operands, expectName, anchor };
    validateOperandCount(context);
    return [
        ...subject(context),
        syntax(context, `.type.${reference.negated ? 'not.' : ''}${reference.matcher}`),
        ...target(context)
    ];
}
