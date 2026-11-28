import type * as TypeScript from 'typescript-beta/ast';
import type { Relation } from './relation-evidence.ts';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import type { AnalyzedSymbol, SourceAnalysis } from './source-analysis-port.ts';
import { sourceSymbol } from './source-analysis.ts';
import type { CallRejection } from './assertion-reference.ts';

type CallRelation = 'acceptsCall' | 'rejectsCall';

type NativeRelationReference = {
    readonly kind: 'relation';
    readonly relation: Relation;
    readonly negated: boolean;
    readonly actual: TypeScript.TypeNode;
    readonly expected: TypeScript.TypeNode;
};
export type CallProbe = {
    readonly kind: 'call';
    readonly relation: CallRelation;
    readonly negated: false;
    readonly reason: CallRejection | null;
    readonly probe: TypeScript.CallExpression;
};
export type KeyReference = {
    readonly kind: 'key';
    readonly relation: 'hasKey' | 'lacksKey';
    readonly negated: false;
    readonly actual: TypeScript.TypeNode;
    readonly key: TypeScript.TypeNode;
    readonly expression: TypeScript.CallExpression;
};
export type NativeReference = CallProbe | KeyReference | NativeRelationReference;

const comparisons: ReadonlyMap<string, Relation> = new Map([
    [ 'equal', 'equal' ],
    [ 'notEqual', 'equal' ],
    [ 'assignableTo', 'assignableTo' ],
    [ 'notAssignableTo', 'assignableTo' ]
]);
const typeMembers = new Set([ ...comparisons.keys(), 'hasKey', 'lacksKey', 'acceptsCall', 'rejectsCall', 'table' ]);

async function expressionSymbol(
    analysis: SourceAnalysis,
    expression: TypeScript.Expression
): Promise<AnalyzedSymbol | undefined> {
    const node = analysis.compiler.isPropertyAccessExpression(expression) ? expression.name : expression;
    return await sourceSymbol(analysis, node);
}

export async function typesMember(
    analysis: SourceAnalysis,
    expression: TypeScript.Expression
): Promise<string | null> {
    if (!analysis.compiler.isPropertyAccessExpression(expression) || !typeMembers.has(expression.name.text)) {
        return null;
    }
    const symbol = await expressionSymbol(analysis, expression.expression);
    const exports = await analysis.getRelationModuleExports();
    return symbol?.name === 'types' && exports.includes(symbol) ? expression.name.text : null;
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
type TypeOperands = readonly [actual: TypeScript.TypeNode, expected: TypeScript.TypeNode];

function typeOperands(syntax: ReferenceSyntax, operands: readonly TypeScript.Expression[]): TypeOperands {
    const [ actual, expected, ...extra ] = syntax.types;
    if (
        actual === undefined || expected === undefined || extra.length > 0 ||
        syntax.operands.length > 0 || operands.length > 0
    ) {
        throw new UnsupportedEvidenceError(
            'Type comparisons require two type arguments and no runtime operands.',
            undefined
        );
    }
    return [ actual, expected ];
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
    relation: CallRelation,
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

function probeExpression(
    compiler: SourceAnalysis['compiler'],
    operands: readonly TypeScript.Expression[]
): TypeScript.CallExpression {
    const [ callback ] = operands;
    if (
        operands.length !== 1 || callback === undefined || !compiler.isArrowFunction(callback) ||
        callback.parameters.length > 0 || !compiler.isCallExpression(callback.body)
    ) {
        throw new UnsupportedEvidenceError('A call assertion requires an inline arrow containing one call.', undefined);
    }
    return callback.body;
}

function callProbe(
    analysis: SourceAnalysis,
    relation: CallRelation,
    syntax: ReferenceSyntax,
    operands: readonly TypeScript.Expression[]
): CallProbe {
    if (syntax.types.length > 0 || syntax.called !== (relation === 'rejectsCall')) {
        throw new UnsupportedEvidenceError('Invalid native call assertion reference.', undefined);
    }
    return {
        kind: 'call',
        relation,
        negated: false,
        reason: callReason(analysis.compiler, relation, syntax),
        probe: probeExpression(analysis.compiler, operands)
    };
}

function modernReference(
    analysis: SourceAnalysis,
    member: string,
    syntax: ReferenceSyntax,
    operands: readonly TypeScript.Expression[]
): NativeReference {
    if (member === 'acceptsCall' || member === 'rejectsCall') {
        return callProbe(analysis, member, syntax, operands);
    }
    const relation = comparisons.get(member);
    if (relation === undefined) {
        throw new UnsupportedEvidenceError('Unknown comparison on types.', undefined);
    }
    const [ actual, expected ] = typeOperands(syntax, operands);
    return {
        kind: 'relation',
        relation,
        negated: member === 'notEqual' || member === 'notAssignableTo',
        actual,
        expected
    };
}

function keyComparison(
    member: KeyReference['relation'],
    expression: TypeScript.CallExpression,
    syntax: ReferenceSyntax,
    operands: readonly TypeScript.Expression[]
): KeyReference {
    const [ actual, key ] = typeOperands(syntax, operands);
    return { kind: 'key', relation: member, negated: false, actual, key, expression };
}

export async function nativeReference(
    analysis: SourceAnalysis,
    node: TypeScript.Expression,
    operands: readonly TypeScript.Expression[] = []
): Promise<NativeReference> {
    const syntax = referenceSyntax(analysis, node);
    const member = await typesMember(analysis, syntax.expression);
    if (member === null) {
        throw new UnsupportedEvidenceError('Assertion reference is not an export of the type-test package.', undefined);
    }
    if ((member === 'hasKey' || member === 'lacksKey') && analysis.compiler.isCallExpression(node)) {
        return keyComparison(member, node, syntax, operands);
    }
    return modernReference(analysis, member, syntax, operands);
}
