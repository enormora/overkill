import type { Diagnostic } from 'typescript-beta/async';
import type { Node } from 'typescript-beta/ast';
import type { CompilerSyntax } from './installed-compiler.ts';
import type { CallRejection } from './assertion-reference.ts';
import type { NativeSite } from './original-assertions.ts';

const wrongArgumentCount = 2554;
const tooFewArguments = 2555;
const overloadArityMismatch = 2575;
const incompatibleArgument = 2345;
const excessProperty = 2353;
const suggestedProperty = 2561;
const incompatibleType = 2322;
const missingProperties = 2739;
const missingManyProperties = 2740;
const missingProperty = 2741;
const noMatchingOverload = 2769;
const argumentCountCodes = new Set([ wrongArgumentCount, tooFewArguments, overloadArityMismatch ]);
const argumentTypeCodes = new Set([
    incompatibleArgument,
    excessProperty,
    suggestedProperty,
    incompatibleType,
    missingProperties,
    missingManyProperties,
    missingProperty
]);

function reason(code: number): CallRejection | null {
    if (argumentCountCodes.has(code)) {
        return 'argument-count';
    }
    if (argumentTypeCodes.has(code)) {
        return 'argument-type';
    }
    return code === noMatchingOverload ? 'no-matching-overload' : null;
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

function contextualContainer(compiler: CompilerSyntax, node: Node): boolean {
    return compiler.isObjectLiteralExpression(node) || compiler.isArrayLiteralExpression(node) ||
        compiler.isPropertyAssignment(node) || compiler.isShorthandPropertyAssignment(node) ||
        compiler.isParenthesizedExpression(node) || compiler.isSpreadElement(node);
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
    if (!contextualContainer(compiler, node)) {
        return false;
    }
    return node.forEachChild(function contextual(child) {
        return atContextualArgument(compiler, child, diagnostic) || undefined;
    }) === true;
}

function appliesToFile(compiler: CompilerSyntax, site: NativeSite, diagnostic: Diagnostic): boolean {
    return String(diagnostic.fileName) === site.path &&
        diagnostic.category === Number(compiler.DiagnosticCategory.Error)
        && (diagnostic.source === undefined || diagnostic.source.length === 0);
}

function ownsCallDiagnostic(compiler: CompilerSyntax, site: NativeSite, diagnostic: Diagnostic): boolean {
    if (site.reference.kind !== 'call' || !appliesToFile(compiler, site, diagnostic)) {
        return false;
    }
    const { probe } = site.reference;
    return contains(probe, diagnostic) &&
        ![ probe.expression, ...probe.arguments ].some(function nested(node) {
            return insideNestedExpression(compiler, node, diagnostic);
        }) &&
        (!argumentTypeCodes.has(diagnostic.code) || probe.arguments.some(function contextual(argument) {
            return atContextualArgument(compiler, argument, diagnostic);
        }));
}

export type CallDiagnostic = { readonly code: number; readonly reason: CallRejection; readonly text: string; };
export type AttributedCallDiagnostics = ReadonlyMap<Node, readonly CallDiagnostic[]>;
type DiagnosticAttribution = {
    readonly attributed: AttributedCallDiagnostics;
    readonly remaining: readonly Diagnostic[];
};
type OwnedCallDiagnostic = { readonly probe: Node; readonly evidence: CallDiagnostic; };

function attributedDiagnostic(
    compiler: CompilerSyntax,
    sites: readonly NativeSite[],
    diagnostic: Diagnostic
): OwnedCallDiagnostic | null {
    const rejection = reason(diagnostic.code);
    if (rejection === null) {
        return null;
    }
    const owners = sites.filter(function owns(site) {
        return ownsCallDiagnostic(compiler, site, diagnostic);
    });
    const [ owner ] = owners;
    if (owners.length !== 1 || owner?.reference.kind !== 'call') {
        return null;
    }
    return {
        probe: owner.reference.probe,
        evidence: { code: diagnostic.code, reason: rejection, text: diagnostic.text }
    };
}

export function attributeCallDiagnostics(
    compiler: CompilerSyntax,
    sites: readonly NativeSite[],
    diagnostics: readonly Diagnostic[]
): DiagnosticAttribution {
    const attributed = new Map<Node, CallDiagnostic[]>();
    const remaining: Diagnostic[] = [];
    for (const diagnostic of diagnostics) {
        const owned = attributedDiagnostic(compiler, sites, diagnostic);
        if (owned === null) {
            remaining.push(diagnostic);
        } else {
            const prior = attributed.get(owned.probe) ?? [];
            prior.push(owned.evidence);
            attributed.set(owned.probe, prior);
        }
    }
    return { attributed, remaining };
}
