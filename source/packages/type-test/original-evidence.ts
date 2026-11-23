import type { Node, TypeNode } from 'typescript-beta/ast';
import { match } from 'ts-pattern';
import type { Type } from 'typescript-beta/async';
import type { NativeSite } from './original-assertions.ts';
import type { TypeAnalysis } from './source-analysis-port.ts';
import type { SiteEvidence } from './native-results.ts';
import { recoveryTypeReason } from './operand-evidence.ts';
import { compareRelation } from './type-relations.ts';

function relationOperands(
    form: NativeSite['reference']['form'],
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

async function operandTypes(analysis: TypeAnalysis, site: NativeSite): Promise<readonly [Type, Type]> {
    const { reference, call } = site;
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

async function hasAuthoredRecoveryType(analysis: TypeAnalysis, site: NativeSite): Promise<boolean> {
    const { compiler, checker } = analysis;
    const references: TypeNode[] = [];
    function visit(node: Node): void {
        if (compiler.isTypeReferenceNode(node) || compiler.isTypeQueryNode(node) || compiler.isImportTypeNode(node)) {
            references.push(node);
        }
        node.forEachChild(visit);
    }
    for (const node of [ ...site.reference.types, ...site.call.arguments.slice(1) ]) {
        visit(node);
    }
    for (const reference of references) {
        const type = await checker.getTypeFromTypeNode(reference);
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
    compilerVersion: string
): Promise<SiteEvidence> {
    const started = performance.now();
    const [ actual, expected ] = await operandTypes(analysis, site);
    const result = await hasAuthoredRecoveryType(analysis, site)
        ? { kind: 'inconclusive' as const, reason: recoveryTypeReason }
        : await compareRelation(analysis, site.reference.relation, actual, expected);
    return {
        site,
        compilerVersion,
        actual: await analysis.checker.typeToString(actual),
        expected: await analysis.checker.typeToString(expected),
        durationMicroseconds: (performance.now() - started) * microsecondsPerMillisecond,
        result: result.kind === 'inconclusive' ? result : {
            kind: 'established',
            holds: site.reference.negated ? !result.holds : result.holds
        }
    };
}
