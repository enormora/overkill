import type * as TypeScript from 'typescript-beta/ast';
import type { Relation } from './relation-evidence.ts';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import type { SourceAnalysis } from './source-analysis-port.ts';
import { sourceSymbol } from './source-analysis.ts';
import type { CallRejection } from './assertion-reference.ts';

type BindingKind = 'relation';
type RelationBinding = {
    readonly relation: Relation;
    readonly kind: BindingKind;
};
type CallBinding = {
    readonly kind: 'call';
    readonly relation: 'acceptsCall' | 'rejectsCall';
};
type Binding = RelationBinding | CallBinding;
const bindings: Readonly<Record<string, Binding>> = {
    sameType: { relation: 'sameType', kind: 'relation' },
    assignableTo: { relation: 'assignableTo', kind: 'relation' },
    assignableFrom: { relation: 'assignableFrom', kind: 'relation' },
    acceptsCall: { relation: 'acceptsCall', kind: 'call' },
    rejectsCall: { relation: 'rejectsCall', kind: 'call' }
};
type ReferenceForm = 'expressions' | 'typed' | 'withActual' | 'withExpected';
export type NativeRelationReference = RelationBinding & {
    readonly negated: boolean;
    readonly form: ReferenceForm;
    readonly types: readonly TypeScript.TypeNode[];
};
export type CallProbe = CallBinding & {
    readonly negated: false;
    readonly reason: CallRejection | null;
    readonly probe: TypeScript.CallExpression;
};
export type NativeReference = NativeRelationReference | CallProbe;
export async function nativeRelationBinding(
    analysis: SourceAnalysis,
    expression: TypeScript.Expression
): Promise<Binding | null> {
    const location = analysis.compiler.isPropertyAccessExpression(expression) ? expression.name : expression;
    const symbol = await sourceSymbol(analysis, location);
    if (symbol === undefined || !Object.hasOwn(bindings, symbol.name)) {
        return null;
    }
    const exports = await analysis.getRelationModuleExports();
    return exports.includes(symbol) ? bindings[symbol.name] ?? null : null;
}
type ReferenceBinding = {
    readonly binding: Binding;
    readonly members: readonly string[];
};
async function referenceBinding(analysis: SourceAnalysis, original: TypeScript.Expression): Promise<ReferenceBinding> {
    let expression = original;
    let members: readonly string[] = [];
    let binding = await nativeRelationBinding(analysis, expression);
    while (binding === null && analysis.compiler.isPropertyAccessExpression(expression)) {
        members = [ expression.name.text, ...members ];
        expression = expression.expression;
        binding = await nativeRelationBinding(analysis, expression);
    }
    if (binding === null) {
        throw new UnsupportedEvidenceError('Assertion reference is not an export of the type-test package.', undefined);
    }
    return { binding, members };
}
const referenceForms: ReadonlyMap<string, ReferenceForm> = new Map([
    [ 'withActual', 'withActual' ],
    [ 'withExpected', 'withExpected' ],
    [ 'expressions', 'expressions' ]
]);
function referenceForm(members: readonly string[]): ReferenceForm {
    const [ member ] = members;
    if (member === undefined) {
        return 'typed';
    }
    const form = referenceForms.get(member);
    if (members.length !== 1 || form === undefined) {
        throw new UnsupportedEvidenceError('Unsupported native assertion reference form.', undefined);
    }
    return form;
}
type ReferenceSyntax = {
    readonly expression: TypeScript.Expression;
    readonly types: readonly TypeScript.TypeNode[];
    readonly operands: readonly TypeScript.Expression[];
    readonly called: boolean;
};
function referenceSyntax(analysis: SourceAnalysis, node: TypeScript.Expression): ReferenceSyntax {
    return analysis.compiler.isCallExpression(node)
        ? {
            expression: node.expression,
            types: Array.from(node.typeArguments ?? []),
            operands: node.arguments,
            called: true
        }
        : { expression: node, types: [], operands: [], called: false };
}
function validateReferenceSyntax(form: ReferenceForm, syntax: ReferenceSyntax): void {
    const count = { typed: 2, withActual: 1, withExpected: 1, expressions: 0 }[form];
    if (syntax.called !== count > 0 || syntax.types.length !== count || syntax.operands.length > 0) {
        throw new UnsupportedEvidenceError('Invalid native reference factory arguments.', undefined);
    }
}
function rejectionReason(value: string): CallRejection {
    if (value === 'argument-count' || value === 'argument-type' || value === 'no-matching-overload') {
        return value;
    }
    throw new UnsupportedEvidenceError('Unknown call rejection reason.', undefined);
}

function callProbe(
    analysis: SourceAnalysis,
    binding: CallBinding,
    members: readonly string[],
    syntax: ReferenceSyntax,
    operands: readonly TypeScript.Expression[]
): CallProbe {
    const { compiler } = analysis;
    const rejects = binding.relation === 'rejectsCall';
    const [ reason ] = syntax.operands;
    const [ callback ] = operands;
    if (
        members.length !== 0 || syntax.types.length !== 0 || syntax.called !== rejects ||
        syntax.operands.length !== Number(rejects) ||
        reason !== undefined && !compiler.isStringLiteral(reason)
    ) {
        throw new UnsupportedEvidenceError('Invalid native call assertion reference.', undefined);
    }
    if (
        operands.length !== 1 || callback === undefined || !compiler.isArrowFunction(callback) ||
        callback.parameters.length !== 0 || !compiler.isCallExpression(callback.body)
    ) {
        throw new UnsupportedEvidenceError('A call assertion requires an inline arrow containing one call.', undefined);
    }
    return {
        ...binding,
        negated: false,
        reason: reason === undefined ? null : rejectionReason(reason.text),
        probe: callback.body
    };
}

export async function nativeReference(
    analysis: SourceAnalysis,
    node: TypeScript.Expression,
    operands: readonly TypeScript.Expression[] = []
): Promise<NativeReference> {
    const syntax = referenceSyntax(analysis, node);
    const { binding, members } = await referenceBinding(analysis, syntax.expression);
    if (binding.kind === 'call') {
        return callProbe(analysis, binding, members, syntax, operands);
    }
    const negated = members[0] === 'not';
    const form = referenceForm(negated ? members.slice(1) : members);
    validateReferenceSyntax(form, syntax);
    return { ...binding, negated, form, types: syntax.types };
}
