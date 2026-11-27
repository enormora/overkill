import type { Diagnostic } from 'typescript-beta/async';
import type { Node } from 'typescript-beta/ast';
import type { CompilerSyntax } from './installed-compiler.ts';
import type { CallRejection } from './assertion-reference.ts';
import type { NativeSite } from './original-assertions.ts';

const argumentCountCodes = new Set([ 2554, 2555, 2575 ]);
const argumentTypeCodes = new Set([ 2345, 2353, 2561 ]);
const contextualArgumentCodes = new Set([ 2322, 2739, 2740, 2741 ]);

function reason(code: number): CallRejection | null {
    if (argumentCountCodes.has(code)) {
        return 'argument-count';
    }
    if (argumentTypeCodes.has(code) || contextualArgumentCodes.has(code)) {
        return 'argument-type';
    }
    return code === 2769 ? 'no-matching-overload' : null;
}

function contains(node: Node, diagnostic: Diagnostic): boolean {
    return node.getStart() <= diagnostic.pos && diagnostic.end <= node.end;
}

function insideNestedExpression(
    compiler: CompilerSyntax,
    node: Node,
    diagnostic: Diagnostic
): boolean {
    if (!contains(node, diagnostic)) {
        return false;
    }
    if (compiler.isCallExpression(node) || compiler.isNewExpression(node) || compiler.isFunctionLike(node)) {
        return node.getStart() !== diagnostic.pos || node.end !== diagnostic.end;
    }
    return node.forEachChild(function nested(child) {
        return insideNestedExpression(compiler, child, diagnostic) || undefined;
    }) === true;
}

function atContextualArgument(
    compiler: CompilerSyntax,
    node: Node,
    diagnostic: Diagnostic
): boolean {
    if (!contains(node, diagnostic)) {
        return false;
    }
    if (node.getStart() === diagnostic.pos && node.end === diagnostic.end) {
        return true;
    }
    if (
        !compiler.isObjectLiteralExpression(node) && !compiler.isArrayLiteralExpression(node) &&
        !compiler.isPropertyAssignment(node) && !compiler.isShorthandPropertyAssignment(node) &&
        !compiler.isParenthesizedExpression(node) && !compiler.isSpreadElement(node)
    ) {
        return false;
    }
    return node.forEachChild(function contextual(child) {
        return atContextualArgument(compiler, child, diagnostic) || undefined;
    }) === true;
}

function ownsCallDiagnostic(compiler: CompilerSyntax, site: NativeSite, diagnostic: Diagnostic): boolean {
    if (
        site.reference.kind !== 'call' || diagnostic.fileName !== site.path ||
        diagnostic.category !== compiler.DiagnosticCategory.Error || Boolean(diagnostic.source)
    ) {
        return false;
    }
    const { probe } = site.reference;
    if (!contains(probe, diagnostic) || insideNestedExpression(compiler, probe.expression, diagnostic)) {
        return false;
    }
    if (probe.arguments.some(function nested(argument) {
        return insideNestedExpression(compiler, argument, diagnostic);
    })) {
        return false;
    }
    if (argumentTypeCodes.has(diagnostic.code) || contextualArgumentCodes.has(diagnostic.code)) {
        return probe.arguments.some(function contextual(argument) {
            return atContextualArgument(compiler, argument, diagnostic);
        });
    }
    return true;
}

export type CallDiagnostic = { readonly code: number; readonly reason: CallRejection; readonly text: string; };

export function attributeCallDiagnostics(
    compiler: CompilerSyntax,
    sites: readonly NativeSite[],
    diagnostics: readonly Diagnostic[]
): {
    readonly attributed: ReadonlyMap<Node, readonly CallDiagnostic[]>;
    readonly remaining: readonly Diagnostic[];
} {
    const attributed = new Map<Node, CallDiagnostic[]>();
    const remaining: Diagnostic[] = [];
    for (const diagnostic of diagnostics) {
        const rejection = reason(diagnostic.code);
        const owners = rejection === null ? [] : sites.filter(function owns(site) {
            return ownsCallDiagnostic(compiler, site, diagnostic);
        });
        const [ owner ] = owners;
        if (rejection === null || owners.length !== 1 || owner?.reference.kind !== 'call') {
            remaining.push(diagnostic);
            continue;
        }
        const { probe } = owner.reference;
        const prior = attributed.get(probe);
        const evidence = { code: diagnostic.code, reason: rejection, text: diagnostic.text };
        if (prior === undefined) {
            attributed.set(probe, [ evidence ]);
        } else {
            prior.push(evidence);
        }
    }
    return { attributed, remaining };
}
