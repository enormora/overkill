import type { NativeReference } from './native-reference.ts';

function typeText(reference: NativeReference, index: number): string {
    const node = reference.types[index];
    if (node === undefined) {
        throw new Error('Native assertion is missing a type argument.');
    }
    return node.getText();
}

function assertionSubject(reference: NativeReference, operands: readonly string[], expectName: string): string {
    if (reference.subjectExpression !== null) {
        return `${expectName}(${reference.subjectExpression})`;
    }
    if (reference.form === 'withActual' || reference.form === 'expressions') {
        const actual = operands[0];
        if (actual === undefined) {
            throw new Error('Native assertion is missing its actual expression.');
        }
        return `${expectName}(${actual})`;
    }
    return `${expectName}<${typeText(reference, 0)}>()`;
}

function relationTarget(reference: NativeReference, operands: readonly string[]): string {
    const operandCounts = { typed: 0, withActual: 1, withExpected: 1, expressions: 2 };
    if (operands.length !== operandCounts[reference.form]) {
        throw new Error('Invalid native relation operand count.');
    }
    if (reference.form === 'typed' || reference.form === 'withActual') {
        return `<${typeText(reference, reference.form === 'typed' ? 1 : 0)}>()`;
    }
    return `(${operands.slice(reference.form === 'expressions' ? 1 : 0).join(', ')})`;
}

function instantiationTarget(reference: NativeReference, operands: readonly string[]): string {
    const expected = reference.form === 'typed' ? 0 : 1;
    if (operands.length !== expected) {
        throw new Error('Invalid instantiation operand count.');
    }
    return `<${typeText(reference, reference.form === 'typed' ? 1 : 0)}>()`;
}

function assertionTarget(reference: NativeReference, operands: readonly string[]): string {
    if (reference.kind === 'relation') {
        return relationTarget(reference, operands);
    }
    if (reference.kind === 'instantiation') {
        return instantiationTarget(reference, operands);
    }
    return `(${operands.slice(reference.form === 'withActual' ? 1 : 0).join(', ')})`;
}

export function referenceExpression(
    reference: NativeReference,
    operands: readonly string[],
    expectName: string
): string {
    return `${assertionSubject(reference, operands, expectName)}.type.${reference.negated ? 'not.' : ''}` +
        `${reference.matcher}${assertionTarget(reference, operands)}`;
}
