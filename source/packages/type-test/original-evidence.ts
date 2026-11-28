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

async function availableKeys(analysis: TypeAnalysis, reference: KeyReference): Promise<Type | undefined> {
    const { checker } = analysis;
    const referenceType = await checker.getTypeAtLocation(reference.expression);
    const properties = await referenceType.getProperties();
    const projection = properties.find(property => property.name.startsWith('__@keyProjection@'));
    if (projection === undefined) {
        return undefined;
    }
    const wrapped = await checker.getTypeOfSymbol(projection);
    const members = wrapped.isUnionType() ? await wrapped.getTypes() : [ wrapped ];
    const tuple = members.find(member => member.isTupleType());
    if (tuple === undefined || !tuple.isTypeReference()) {
        return undefined;
    }
    const [ keys ] = await checker.getTypeArguments(tuple);
    return keys;
}

async function evaluateKey(
    analysis: TypeAnalysis,
    reference: KeyReference
): Promise<Pick<SiteEvidence, 'actual' | 'expected' | 'result'>> {
    const { compiler, checker } = analysis;
    const [actual, key, keys] = await Promise.all([
        checker.getTypeFromTypeNode(reference.actual),
        checker.getTypeFromTypeNode(reference.key),
        availableKeys(analysis, reference)
    ]);
    const validKey = key.isStringLiteralType() || key.isNumberLiteralType() ||
        key.flags === compiler.TypeFlags.UniqueESSymbol;
    const problem = !validKey ? 'Key comparisons require one literal or unique-symbol key.'
        : keys === undefined ? 'The compiler did not resolve the available key type.'
        : await hasAuthoredRecoveryType(analysis, [reference.actual, reference.key]) ? recoveryTypeReason
        : actual.isErrorType() ? recoveryTypeReason
        : await invalidOperand(analysis, [ key, keys ]);
    const actualType = await checker.typeToString(actual);
    const rendered = {
        actual: keys === undefined ? actualType : `${actualType} (keys: ${await checker.typeToString(keys)})`,
        expected: await checker.typeToString(key)
    };
    if (problem !== null || keys === undefined) {
        return { ...rendered, result: { kind: 'inconclusive', reason: problem ?? 'Missing key type.' } };
    }
    const present = await checker.isTypeAssignableTo(key, keys);
    return { ...rendered, result: { kind: 'established', holds: present === (reference.relation === 'hasKey') } };
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

const microsecondsPerMillisecond = 1000;

function evaluateCall(
    site: NativeSite,
    compilerVersion: string,
    reason: CallProbe['reason'],
    diagnostics: readonly CallDiagnostic[]
): SiteEvidence {
    const started = performance.now();
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
    return {
        site,
        compilerVersion,
        actual,
        expected: reason ?? 'Call accepted',
        diagnostics,
        durationMicroseconds: (performance.now() - started) * microsecondsPerMillisecond,
        result: { kind: 'established', holds }
    };
}

export async function evaluateSite(
    analysis: TypeAnalysis,
    site: NativeSite,
    compilerVersion: string,
    diagnostics: readonly CallDiagnostic[]
): Promise<SiteEvidence> {
    const started = performance.now();
    const { reference } = site;
    if (reference.kind === 'call') {
        return evaluateCall(site, compilerVersion, reference.reason, diagnostics);
    }
    if (reference.kind === 'key') {
        const evidence = await evaluateKey(analysis, reference);
        return { ...evidence, site, compilerVersion, diagnostics: [],
            durationMicroseconds: (performance.now() - started) * microsecondsPerMillisecond };
    }
    const [ actual, expected ] = await Promise.all([
        operandType(analysis, reference.actual),
        operandType(analysis, reference.expected)
    ]);
    const result = await hasAuthoredRecoveryType(analysis, [reference.actual.node, reference.expected.node])
        ? { kind: 'inconclusive' as const, reason: recoveryTypeReason }
        : await compareRelation(analysis, reference.relation, actual, expected);
    const actualText = await analysis.checker.typeToString(actual);
    const expectedText = await analysis.checker.typeToString(expected);
    const sameDisplay = actualText === expectedText && result.kind === 'established' &&
        result.holds === reference.negated;
    return {
        site,
        compilerVersion,
        diagnostics: [],
        actual: sameDisplay ? `${actualText} (${reference.actual.node.getText()})` : actualText,
        expected: sameDisplay ? `${expectedText} (${reference.expected.node.getText()})` : expectedText,
        durationMicroseconds: (performance.now() - started) * microsecondsPerMillisecond,
        result: result.kind === 'inconclusive' ? result : {
            kind: 'established',
            holds: site.reference.negated ? !result.holds : result.holds
        }
    };
}
