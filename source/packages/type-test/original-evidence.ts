import type { Node, TypeNode } from 'typescript-beta/ast';
import type { Type } from 'typescript-beta/async';
import type { CallDiagnostic } from './call-diagnostics.ts';
import type { CallProbe, KeyReference } from './native-reference.ts';
import type { NativeSite, Operand } from './original-assertions.ts';
import type { TypeAnalysis } from './source-analysis-port.ts';
import type { SiteEvidence } from './native-results.ts';
import { invalidOperand, recoveryTypeReason } from './operand-evidence.ts';
import { compareRelation } from './type-relations.ts';

async function operandType(analysis: TypeAnalysis, operand: Operand): Promise<Type> {
    return operand.kind === 'type'
        ? await analysis.checker.getTypeFromTypeNode(operand.node)
        : await analysis.checker.getTypeAtLocation(operand.node);
}

async function hasAuthoredRecoveryType(
    analysis: TypeAnalysis,
    operands: readonly Node[]
): Promise<boolean> {
    const { compiler, checker } = analysis;
    const references: TypeNode[] = [];
    function visit(node: Node): void {
        if (compiler.isTypeReferenceNode(node) || compiler.isTypeQueryNode(node) || compiler.isImportTypeNode(node)) {
            references.push(node);
        }
        node.forEachChild(visit);
    }
    for (const node of operands) {
        visit(node);
    }
    for (const typeNode of references) {
        const type = await checker.getTypeFromTypeNode(typeNode);
        if (type.isErrorType()) {
            return true;
        }
    }
    return false;
}

async function projectedKeyType(checker: TypeAnalysis['checker'], wrapped: Type): Promise<Type | undefined> {
    const members = wrapped.isUnionType() ? await wrapped.getTypes() : [ wrapped ];
    const tuple = members.find(function projection(member) {
        return member.isTupleType();
    });
    if (tuple === undefined) {
        return undefined;
    }
    const [ keys ] = await checker.getTypeArguments(tuple);
    return keys;
}

async function availableKeys(analysis: TypeAnalysis, reference: KeyReference): Promise<Type | undefined> {
    const { checker } = analysis;
    const referenceType = await checker.getTypeAtLocation(reference.expression);
    const properties = await referenceType.getProperties();
    const projection = properties.find(function projected(property) {
        return property.name.startsWith('__@keyProjection@');
    });
    if (projection === undefined) {
        return undefined;
    }
    const wrapped = await checker.getTypeOfSymbol(projection);
    return await projectedKeyType(checker, wrapped);
}

function isSingleKey(analysis: TypeAnalysis, key: Type): boolean {
    return key.isStringLiteralType() || key.isNumberLiteralType() ||
        key.flags === analysis.compiler.TypeFlags.UniqueESSymbol;
}

type Evidence = Pick<SiteEvidence, 'actual' | 'diagnostics' | 'expected' | 'result'>;

async function keyResult(
    analysis: TypeAnalysis,
    reference: KeyReference,
    types: { readonly actual: Type; readonly key: Type; readonly keys: Type | undefined; }
): Promise<Evidence['result']> {
    const { actual, key, keys } = types;
    if (!isSingleKey(analysis, key)) {
        return { kind: 'inconclusive', reason: 'Key comparisons require one literal or unique-symbol key.' };
    }
    if (keys === undefined) {
        return { kind: 'inconclusive', reason: 'The compiler did not resolve the available key type.' };
    }
    if (actual.isErrorType() || await hasAuthoredRecoveryType(analysis, [ reference.actual, reference.key ])) {
        return { kind: 'inconclusive', reason: recoveryTypeReason };
    }
    const problem = await invalidOperand(analysis, [ key, keys ]);
    return problem === null
        ? {
            kind: 'established',
            holds: await analysis.checker.isTypeAssignableTo(key, keys) ===
                (reference.relation === 'hasKey')
        }
        : { kind: 'inconclusive', reason: problem };
}

async function evaluateKey(analysis: TypeAnalysis, reference: KeyReference): Promise<Evidence> {
    const { checker } = analysis;
    const [ actual, key, keys ] = await Promise.all([
        checker.getTypeFromTypeNode(reference.actual),
        checker.getTypeFromTypeNode(reference.key),
        availableKeys(analysis, reference)
    ]);
    const actualType = await checker.typeToString(actual);
    return {
        diagnostics: [],
        actual: keys === undefined ? actualType : `${actualType} (keys: ${await checker.typeToString(keys)})`,
        expected: await checker.typeToString(key),
        result: await keyResult(analysis, reference, { actual, key, keys })
    };
}

function evaluateCall(reason: CallProbe['reason'], diagnostics: readonly CallDiagnostic[]): Evidence {
    const holds = reason === null
        ? diagnostics.length === 0
        : diagnostics.length > 0 && diagnostics.every(function expected(diagnostic) {
            return diagnostic.reason === reason;
        });
    const actual = diagnostics.length === 0 ? 'Call accepted' : diagnostics
        .map(function describe(diagnostic) {
            return `TS${diagnostic.code} (${diagnostic.reason}): ${diagnostic.text}`;
        })
        .join('\n');
    return { actual, expected: reason ?? 'Call accepted', diagnostics, result: { kind: 'established', holds } };
}

function negateResult(result: Evidence['result'], negated: boolean): Evidence['result'] {
    return result.kind === 'inconclusive' ? result : { kind: 'established', holds: result.holds !== negated };
}

async function evaluateRelation(
    analysis: TypeAnalysis,
    reference: Extract<NativeSite['reference'], { readonly kind: 'relation'; }>
): Promise<Evidence> {
    const [ actual, expected ] = await Promise.all([
        operandType(analysis, reference.actual),
        operandType(analysis, reference.expected)
    ]);
    const result = await hasAuthoredRecoveryType(analysis, [ reference.actual.node, reference.expected.node ])
        ? { kind: 'inconclusive' as const, reason: recoveryTypeReason }
        : await compareRelation(analysis, reference.relation, actual, expected);
    const actualText = await analysis.checker.typeToString(actual);
    const expectedText = await analysis.checker.typeToString(expected);
    const failure = result.kind === 'established' && result.holds === reference.negated;
    const showSources = actualText === expectedText && failure;
    return {
        diagnostics: [],
        actual: showSources ? `${actualText} (${reference.actual.node.getText()})` : actualText,
        expected: showSources ? `${expectedText} (${reference.expected.node.getText()})` : expectedText,
        result: negateResult(result, reference.negated)
    };
}

async function assertionEvidence(
    analysis: TypeAnalysis,
    reference: NativeSite['reference'],
    diagnostics: readonly CallDiagnostic[]
): Promise<Evidence> {
    if (reference.kind === 'call') {
        return evaluateCall(reference.reason, diagnostics);
    }
    return reference.kind === 'key'
        ? await evaluateKey(analysis, reference)
        : await evaluateRelation(analysis, reference);
}

const microsecondsPerMillisecond = 1000;

export async function evaluateSite(
    analysis: TypeAnalysis,
    site: NativeSite,
    compilerVersion: string,
    diagnostics: readonly CallDiagnostic[]
): Promise<SiteEvidence> {
    const started = performance.now();
    const evidence = await assertionEvidence(analysis, site.reference, diagnostics);
    return {
        ...evidence,
        site,
        compilerVersion,
        durationMicroseconds: (performance.now() - started) * microsecondsPerMillisecond
    };
}
