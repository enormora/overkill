import type { Node, TypeNode } from 'typescript-beta/ast';
import { match } from 'ts-pattern';
import type { Type } from 'typescript-beta/async';
import type { CallDiagnostic } from './call-diagnostics.ts';
import type { NativeRelationReference } from './native-reference.ts';
import type { NativeSite } from './original-assertions.ts';
import type { TypeAnalysis } from './source-analysis-port.ts';
import type { SiteEvidence } from './native-results.ts';
import { recoveryTypeReason } from './operand-evidence.ts';
import { compareRelation } from './type-relations.ts';

function relationOperands(
    form: NativeRelationReference['form'],
    types: readonly Type[],
    expressions: readonly Type[]
): readonly [Type | undefined, Type | undefined] {
    return match(form)
        .returnType<readonly [Type | undefined, Type | undefined]>()
        .with('typed', function () {
            return [ types[0], types[1] ];
        })
        .with('withActual', function () {
            return [ expressions[0], types[0] ];
        })
        .with('withExpected', function () {
            return [ types[0], expressions[0] ];
        })
        .with('expressions', function () {
            return [ expressions[0], expressions[1] ];
        })
        .exhaustive();
}

async function operandTypes(
    analysis: TypeAnalysis,
    site: NativeSite,
    reference: NativeRelationReference
): Promise<readonly [Type, Type]> {
    const { call } = site;
    const operands = call.arguments.slice(1);
    const types = await Promise.all(reference.types.map(async function type(node) {
        return await analysis.checker.getTypeFromTypeNode(node);
    }));
    const expressions = await Promise.all(operands.map(async function type(node) {
        return await analysis.checker.getTypeAtLocation(node);
    }));
    const [ actual, expected ] = relationOperands(reference.form, types, expressions);
    if (actual === undefined || expected === undefined) {
        throw new Error('Missing type relation operands.');
    }
    return [ actual, expected ];
}

async function hasAuthoredRecoveryType(
    analysis: TypeAnalysis,
    site: NativeSite,
    reference: NativeRelationReference
): Promise<boolean> {
    const { compiler, checker } = analysis;
    const references: TypeNode[] = [];
    function visit(node: Node): void {
        if (compiler.isTypeReferenceNode(node) || compiler.isTypeQueryNode(node) || compiler.isImportTypeNode(node)) {
            references.push(node);
        }
        node.forEachChild(visit);
    }
    for (const node of [ ...reference.types, ...site.call.arguments.slice(1) ]) {
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

export async function evaluateSite(
    analysis: TypeAnalysis,
    site: NativeSite,
    compilerVersion: string,
    diagnostics: readonly CallDiagnostic[]
): Promise<SiteEvidence> {
    const started = performance.now();
    const { reference } = site;
    if (reference.kind === 'call') {
        const { reason } = reference;
        const holds = reason === null
            ? diagnostics.length === 0
            : diagnostics.length > 0 && diagnostics.every(function expected(diagnostic) {
                return diagnostic.reason === reason;
            });
        return {
            site,
            compilerVersion,
            actual: diagnostics.map(function describe(diagnostic) {
                return `TS${diagnostic.code} (${diagnostic.reason}): ${diagnostic.text}`;
            }).join('\n') || 'Call accepted',
            expected: reason ?? 'Call accepted',
            diagnostics,
            durationMicroseconds: (performance.now() - started) * microsecondsPerMillisecond,
            result: { kind: 'established', holds }
        };
    }
    const [ actual, expected ] = await operandTypes(analysis, site, reference);
    const result = await hasAuthoredRecoveryType(analysis, site, reference)
        ? { kind: 'inconclusive' as const, reason: recoveryTypeReason }
        : await compareRelation(analysis, reference.relation, actual, expected);
    return {
        site,
        compilerVersion,
        diagnostics: [],
        actual: await analysis.checker.typeToString(actual),
        expected: await analysis.checker.typeToString(expected),
        durationMicroseconds: (performance.now() - started) * microsecondsPerMillisecond,
        result: result.kind === 'inconclusive' ? result : {
            kind: 'established',
            holds: site.reference.negated ? !result.holds : result.holds
        }
    };
}
