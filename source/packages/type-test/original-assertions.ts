import type * as TypeScript from 'typescript-beta/ast';
import {
    resolveSourceLocation,
    type SourceLocation,
    type TestBodyOrigin,
    type TestPlan,
    type WorkId
} from '../engine/engine.entry-point.ts';
import { UnsupportedEvidenceError } from './unsupported-evidence-error.ts';
import type { SourceAnalysis } from './source-analysis-port.ts';
import { resolveBodyOrigin, resolveTypeTableRow, namedBodyParameter, type SourceBody } from './source-ownership.ts';
import { nativeReference, type NativeReference } from './native-reference.ts';
import { scopeAssertions, assertionAnnotation } from './scope-assertions.ts';

type SourceRange = {
    readonly start: number;
    readonly end: number;
};
export type NativeSite = {
    readonly path: string;
    readonly range: SourceRange;
    readonly owners: readonly WorkId[];
    readonly line: number;
    readonly column: number;
    readonly message: string | null;
    readonly label: string;
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
        readonly owner: WorkId;
        readonly location: SourceLocation;
        readonly reason: string;
    }[];
};
function authoredPosition(node: TypeScript.Node): Pick<NativeSite, 'column' | 'line' | 'path' | 'range'> {
    const file = node.getSourceFile();
    const range = { start: node.getStart(file), end: node.end };
    const position = file.getLineAndCharacterOfPosition(range.start);
    return { path: file.fileName, range, line: position.line + 1, column: position.character + 1 };
}
function authoredLocation(node: TypeScript.Node): SourceLocation {
    const { path, line, column } = authoredPosition(node);
    return { kind: 'known', file: path, line, column };
}
function validateAssertionSyntax(analysis: SourceAnalysis, call: TypeScript.CallExpression): void {
    if (call.typeArguments !== undefined || call.arguments.some(analysis.compiler.isSpreadElement)) {
        throw new UnsupportedEvidenceError(
            'Explicit assertion type arguments and spread operands are unsupported.',
            undefined
        );
    }
}
function assertionLabel(reference: NativeReference): string {
    if (reference.kind === 'relation' && reference.negated) {
        return reference.relation === 'equal' ? 'notEqual' : 'notAssignableTo';
    }
    return reference.relation;
}

async function tableSite(
    analysis: SourceAnalysis,
    node: TypeScript.CallExpression,
    owner: WorkId
): Promise<NativeSite> {
    const binding = await nativeReference(analysis, node);
    if (binding.kind === 'call') {
        throw new UnsupportedEvidenceError('Type-table rows require direct comparisons from types.', undefined);
    }
    return {
        ...authoredPosition(node),
        call: node,
        owners: [ owner ],
        message: null,
        label: assertionLabel(binding),
        reference: binding
    };
}

async function assertionSite(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    owner: WorkId
): Promise<NativeSite> {
    validateAssertionSyntax(analysis, call);
    const reference = call.arguments[0];
    if (reference === undefined) {
        throw new UnsupportedEvidenceError('Native assertion is missing its reference.', undefined);
    }
    const binding = await nativeReference(analysis, reference, call.arguments.slice(1));
    return {
        call,
        reference: binding,
        ...authoredPosition(binding.kind === 'call' ? binding.probe : call),
        owners: [ owner ],
        message: await assertionAnnotation(analysis, call),
        label: assertionLabel(binding)
    };
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
type AssertionCollection = {
    readonly site: (call: TypeScript.CallExpression) => NativeSite | undefined;
    readonly recordSite: (site: NativeSite) => void;
    readonly recordModule: (file: TypeScript.SourceFile) => void;
    readonly recordIssue: (issue: OriginalAssertionPlan['issues'][number]) => void;
};

type OwnedAssertion = {
    readonly owner: WorkId;
    readonly read: typeof assertionSite;
};

async function collectSite(
    analysis: SourceAnalysis,
    collection: AssertionCollection,
    call: TypeScript.CallExpression,
    source: OwnedAssertion
): Promise<void> {
    const { owner, read } = source;
    const existing = collection.site(call);
    if (existing !== undefined) {
        collection.recordSite({ ...existing, owners: [ ...existing.owners, owner ] });
        return;
    }
    try {
        collection.recordSite(await read(analysis, call, owner));
    } catch (error: unknown) {
        if (!(error instanceof UnsupportedEvidenceError)) {
            throw error;
        }
        collection.recordIssue({ owner, location: authoredLocation(call), reason: error.message });
    }
}

async function collectBody(
    analysis: SourceAnalysis,
    collection: AssertionCollection,
    body: SourceBody,
    owner: WorkId
): Promise<void> {
    collection.recordModule(body.getSourceFile());
    const scope = body.parameters.length === 0 ? null : namedBodyParameter(analysis, body);
    const calls = await scopeAssertions(analysis, body, scope, function unsupported(node, error) {
        collection.recordIssue({ owner, location: authoredLocation(node), reason: error.message });
    });
    for (const call of calls) {
        await collectSite(analysis, collection, call, { owner, read: assertionSite });
    }
}

async function collectTableRow(
    analysis: SourceAnalysis,
    collection: AssertionCollection,
    row: readonly TypeScript.Expression[],
    owner: WorkId
): Promise<void> {
    for (const node of row) {
        collection.recordModule(node.getSourceFile());
        if (analysis.compiler.isCallExpression(node)) {
            await collectSite(analysis, collection, node, { owner, read: tableSite });
        } else {
            collection.recordIssue({
                owner,
                location: authoredLocation(node),
                reason: 'Author each type comparison directly inside the row.'
            });
        }
    }
}

async function collectOwnedCase(
    analysis: SourceAnalysis,
    collection: AssertionCollection,
    testCase: TestPlan['cases'][number]
): Promise<void> {
    const { bodyOrigin, workId } = testCase;
    const row = bodyOrigin === null ? null : await resolveTypeTableRow(analysis, bodyOrigin, testCase.id.title);
    if (row === null) {
        await collectBody(analysis, collection, await ownedBody(analysis, testCase), workId);
        return;
    }
    await collectTableRow(analysis, collection, row, workId);
}

async function collectCase(
    analysis: SourceAnalysis,
    collection: AssertionCollection,
    testCase: TestPlan['cases'][number]
): Promise<void> {
    try {
        await collectOwnedCase(analysis, collection, testCase);
    } catch (error: unknown) {
        if (!(error instanceof UnsupportedEvidenceError)) {
            throw error;
        }
        const location = resolveSourceLocation(testCase.bodyOrigin?.location ?? testCase.definitionLocations[0]);
        collection.recordIssue({ owner: testCase.workId, location, reason: error.message });
    }
}

export async function collectOriginalAssertions(
    analysis: SourceAnalysis,
    plan: TestPlan
): Promise<OriginalAssertionPlan> {
    const modules = new Map<string, string>();
    const sites = new Map<TypeScript.CallExpression, NativeSite>();
    const issues: OriginalAssertionPlan['issues'][number][] = [];
    const collection: AssertionCollection = {
        site: sites.get.bind(sites),
        recordSite(site) {
            sites.set(site.call, site);
        },
        recordModule(file) {
            modules.set(file.fileName, file.text);
        },
        recordIssue(issue) {
            issues.push(issue);
        }
    };
    for (const testCase of plan.cases) {
        if (testCase.execution.kind !== 'skip') {
            await collectCase(analysis, collection, testCase);
        }
    }
    return {
        modules: Array.from(modules, function source(entry) {
            const [ path, originalText ] = entry;
            return { path, originalText };
        }),
        sites: Array.from(sites.values()),
        issues
    };
}
