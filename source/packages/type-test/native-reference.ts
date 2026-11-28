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
type Binding = CallBinding | RelationBinding;
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
export type NativeReference = CallProbe | NativeRelationReference;
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
    const reasons: readonly CallRejection[] = [ 'argument-count', 'argument-type', 'no-matching-overload' ];
    const match = reasons.find(function matches(reason) {
        return reason === value;
    });
    if (match !== undefined) {
        return match;
    }
    throw new UnsupportedEvidenceError('Unknown call rejection reason.', undefined);
}

function callReason(
    compiler: SourceAnalysis['compiler'],
    relation: CallBinding['relation'],
    syntax: ReferenceSyntax
): CallRejection | null {
    const [ reason ] = syntax.operands;
    if (relation === 'acceptsCall') {
        return null;
    }
    if (syntax.operands.length !== 1 || reason === undefined || !compiler.isStringLiteral(reason)) {
        throw new UnsupportedEvidenceError('Call rejection requires one literal reason.', undefined);
    }
    return rejectionReason(reason.text);
}

function blockProbe(
    compiler: SourceAnalysis['compiler'],
    body: TypeScript.Block
): TypeScript.Expression | undefined {
    const [ statement ] = body.statements;
    if (body.statements.length !== 1 || statement === undefined) {
        return undefined;
    }
    if (compiler.isExpressionStatement(statement) || compiler.isReturnStatement(statement)) {
        return statement.expression;
    }
    return undefined;
}

function callbackProbe(
    compiler: SourceAnalysis['compiler'],
    callback: TypeScript.Expression
): TypeScript.Expression | undefined {
    if (
        !compiler.isArrowFunction(callback) && !compiler.isFunctionExpression(callback) ||
        callback.parameters.length > 0 || callback.asteriskToken !== undefined
    ) {
        return undefined;
    }
    const { body } = callback;
    return compiler.isBlock(body) ? blockProbe(compiler, body) : body;
}

function probeExpression(
    compiler: SourceAnalysis['compiler'],
    operands: readonly TypeScript.Expression[]
): TypeScript.CallExpression {
    const [ callback ] = operands;
    if (operands.length === 1 && callback !== undefined) {
        const call = callbackProbe(compiler, callback);
        if (call !== undefined && compiler.isCallExpression(call)) {
            return call;
        }
    }
    throw new UnsupportedEvidenceError('A call assertion requires an inline function containing one call.', undefined);
}

type CallReferenceBinding = ReferenceBinding & { readonly binding: CallBinding; };

function callProbe(
    analysis: SourceAnalysis,
    reference: CallReferenceBinding,
    syntax: ReferenceSyntax,
    operands: readonly TypeScript.Expression[]
): CallProbe {
    if (
        reference.members.length > 0 || syntax.types.length > 0 ||
        syntax.called !== (reference.binding.relation === 'rejectsCall')
    ) {
        throw new UnsupportedEvidenceError('Invalid native call assertion reference.', undefined);
    }
    return {
        ...reference.binding,
        negated: false,
        reason: callReason(analysis.compiler, reference.binding.relation, syntax),
        probe: probeExpression(analysis.compiler, operands)
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
        return callProbe(analysis, { binding, members }, syntax, operands);
    }
    const negated = members[0] === 'not';
    const form = referenceForm(negated ? members.slice(1) : members);
    validateReferenceSyntax(form, syntax);
    return { ...binding, negated, form, types: syntax.types };
}
