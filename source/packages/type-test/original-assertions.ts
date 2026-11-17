import type * as TypeScript from 'typescript-beta/ast';
import { resolveSourceLocation, type TestBodyOrigin, type TestPlan } from '../engine/engine.entry-point.ts';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import type { SourceAnalysis } from './source-analysis.ts';
import { resolveBodyOrigin, namedBodyParameter, type SourceBody } from './source-ownership.ts';
import { nativeReference, type NativeReference } from './native-reference.ts';
import { scopeAssertions, assertionAnnotation } from './scope-assertions.ts';

type SourceRange = {
    readonly start: number;
    readonly end: number;
};
export type NativeSite = {
    readonly path: string;
    readonly range: SourceRange;
    readonly owners: readonly string[];
    readonly line: number;
    readonly column: number;
    readonly message: string | null;
    readonly call: TypeScript.CallExpression;
    readonly reference: NativeReference;
};
export type OriginalAssertionPlan = {
    readonly modules: readonly {
        readonly path: string;
        readonly originalText: string;
    }[];
    readonly sites: readonly NativeSite[];
    readonly issues: readonly {
        readonly owner: string;
        readonly reason: string;
    }[];
};
export function caseKey(testCase: TestPlan['cases'][number]): string {
    return JSON.stringify([ testCase.id.file, testCase.id.suite, testCase.id.title, testCase.id.params ]);
}
async function assertionSite(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    owners: readonly string[]
): Promise<NativeSite> {
    const file = call.getSourceFile();
    const range = { start: call.getStart(file), end: call.end };
    const position = file.getLineAndCharacterOfPosition(range.start);
    const reference = call.arguments[0];
    if (reference === undefined) {
        throw new UnsupportedEvidenceError('Native assertion is missing its reference.', undefined);
    }
    return {
        call,
        reference: await nativeReference(analysis, reference),
        path: file.fileName,
        range,
        owners,
        message: await assertionAnnotation(analysis, call),
        line: position.line + 1,
        column: position.character + 1
    };
}
function validateAssertionSyntax(analysis: SourceAnalysis, call: TypeScript.CallExpression): void {
    if (call.typeArguments !== undefined || call.arguments.some(analysis.compiler.isSpreadElement)) {
        throw new UnsupportedEvidenceError(
            'Explicit assertion type arguments and spread operands are unsupported.',
            undefined
        );
    }
}
function bodyAnchor(origin: TestBodyOrigin): string {
    const location = resolveSourceLocation(origin.location);
    return location.kind === 'known'
        ? `${location.file}:${location.line}:${location.column}`
        : 'unknown source';
}
async function ownedBody(analysis: SourceAnalysis, testCase: TestPlan['cases'][number]): Promise<SourceBody> {
    if (testCase.bodyOrigin === null) {
        throw new UnsupportedEvidenceError('Selected type-test case has no callback source ownership.', undefined);
    }
    if (
        Object.values(testCase.controls).some(function configured(value) {
            return value !== null;
        })
    ) {
        throw new Error('Type-test cases do not support runtime execution controls.');
    }
    try {
        return await resolveBodyOrigin(analysis, testCase.bodyOrigin);
    } catch (error: unknown) {
        if (!(error instanceof UnsupportedEvidenceError)) {
            throw error;
        }
        const reason = error.message;
        throw new UnsupportedEvidenceError(
            `Cannot locate body of "${testCase.id.title}" at ${bodyAnchor(testCase.bodyOrigin)}: ${reason}`,
            { cause: error }
        );
    }
}
async function ownedSite(
    analysis: SourceAnalysis,
    sites: readonly NativeSite[],
    call: TypeScript.CallExpression,
    owner: string
): Promise<readonly NativeSite[]> {
    validateAssertionSyntax(analysis, call);
    const index = sites.findIndex(function sameSite(site) {
        return site.call === call;
    });
    const existing = sites[index];
    if (existing === undefined) {
        return [ ...sites, await assertionSite(analysis, call, [ owner ]) ];
    }
    return sites.map(function addOwner(site, position) {
        return position === index ? { ...site, owners: [ ...site.owners, owner ] } : site;
    });
}
async function collectSupportedSite(
    analysis: SourceAnalysis,
    collection: OriginalAssertionPlan,
    call: TypeScript.CallExpression,
    owner: string
): Promise<OriginalAssertionPlan> {
    try {
        return { ...collection, sites: await ownedSite(analysis, collection.sites, call, owner) };
    } catch (error: unknown) {
        if (!(error instanceof UnsupportedEvidenceError)) {
            throw error;
        }
        return { ...collection, issues: [ ...collection.issues, { owner, reason: error.message } ] };
    }
}
async function collectCase(
    analysis: SourceAnalysis,
    collection: OriginalAssertionPlan,
    testCase: TestPlan['cases'][number]
): Promise<OriginalAssertionPlan> {
    const body = await ownedBody(analysis, testCase);
    const file = body.getSourceFile();
    const known = collection.modules.some(function existing(module) {
        return module.path === file.fileName;
    });
    const modules = known
        ? collection.modules
        : [ ...collection.modules, { path: file.fileName, originalText: file.text } ];
    const calls = await scopeAssertions(analysis, body, namedBodyParameter(analysis, body));
    let result: OriginalAssertionPlan = { ...collection, modules };
    for (const call of calls) {
        result = await collectSupportedSite(analysis, result, call, caseKey(testCase));
    }
    return result;
}
async function collectSupportedCase(
    analysis: SourceAnalysis,
    collection: OriginalAssertionPlan,
    testCase: TestPlan['cases'][number]
): Promise<OriginalAssertionPlan> {
    if (testCase.execution.kind === 'skip') {
        return collection;
    }
    try {
        return await collectCase(analysis, collection, testCase);
    } catch (error: unknown) {
        if (!(error instanceof UnsupportedEvidenceError)) {
            throw error;
        }
        return { ...collection, issues: [ ...collection.issues, { owner: caseKey(testCase), reason: error.message } ] };
    }
}
export async function collectOriginalAssertions(
    analysis: SourceAnalysis,
    plan: TestPlan
): Promise<OriginalAssertionPlan> {
    let collection: OriginalAssertionPlan = { modules: [], sites: [], issues: [] };
    for (const testCase of plan.cases) {
        collection = await collectSupportedCase(analysis, collection, testCase);
    }
    return collection;
}
