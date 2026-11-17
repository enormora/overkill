import type * as TypeScript from 'typescript-beta/ast';
import { resolveSourceLocation, type TestBodyOrigin, type TestPlan } from '../engine/engine.entry-point.ts';
import { rejectForeignCheckerBoundaries } from './checker-boundary-validation.ts';
import type { SourceAnalysis } from './source-analysis.ts';
import {
    replaceMappedSource,
    replaceMappedText,
    mapSourceRange,
    type TranslatedModule,
    type SourceRange,
    type SourceFragment
} from './generated-source.ts';
import { resolveBodyOrigin, namedBodyParameter, type SourceBody } from './source-ownership.ts';
import { nativeReference } from './native-reference.ts';
import { referenceExpression } from './native-reference-expression.ts';
import { scopeAssertions, assertionAnnotation } from './scope-assertions.ts';

type SourceReplacement = {
    readonly range: SourceRange;
    readonly fragments: readonly SourceFragment[];
};
export type NativeSite = {
    readonly path: string;
    readonly range: SourceRange;
    readonly owners: readonly string[];
    readonly line: number;
    readonly column: number;
    readonly message: string | null;
};
export type NativeTranslation = {
    readonly modules: readonly TranslatedModule[];
    readonly sites: readonly NativeSite[];
};
type BodyOwnership = {
    readonly body: SourceBody;
    readonly owners: readonly string[];
};
type BodyTranslation = {
    readonly sites: readonly NativeSite[];
    readonly replacements: readonly SourceReplacement[];
};
type AssertionContext = {
    readonly analysis: SourceAnalysis;
    readonly expectName: string;
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
    return {
        path: file.fileName,
        range,
        owners,
        message: await assertionAnnotation(analysis, call),
        line: position.line + 1,
        column: position.character + 1
    };
}

function validateAssertionSyntax(context: AssertionContext, call: TypeScript.CallExpression): void {
    if (call.typeArguments !== undefined || call.arguments.some(context.analysis.compiler.isSpreadElement)) {
        throw new Error('Explicit assertion type arguments and spread operands are unsupported.');
    }
}

async function assertionChanges(
    context: AssertionContext,
    call: TypeScript.CallExpression
): Promise<readonly SourceReplacement[]> {
    validateAssertionSyntax(context, call);
    const referenceNode = call.arguments[0];
    if (referenceNode === undefined) {
        throw new Error('Native assertion is missing its reference.');
    }
    const reference = await nativeReference(context.analysis, referenceNode);
    const marker = context.analysis.compiler.isCallExpression(referenceNode) ? referenceNode.expression : referenceNode;
    const range = { start: call.getStart(), end: call.end };
    return [ {
        range,
        fragments: [
            { kind: 'anchored', original: range, text: '(' },
            { kind: 'copied', original: { start: call.expression.getStart(), end: call.expression.end } },
            { kind: 'anchored', original: range, text: ', void ' },
            { kind: 'copied', original: { start: marker.getStart(), end: marker.end } },
            { kind: 'anchored', original: range, text: ', ' },
            ...referenceExpression(reference, call.arguments.slice(1), context.expectName, range),
            { kind: 'anchored', original: range, text: ')' }
        ]
    } ];
}

async function translatedBody(context: AssertionContext, ownership: BodyOwnership): Promise<BodyTranslation> {
    const scopeParameter = namedBodyParameter(context.analysis, ownership.body);
    const calls = await scopeAssertions(context.analysis, ownership.body, scopeParameter);
    const sites: NativeSite[] = [];
    const replacements: SourceReplacement[] = [];
    for (const call of calls) {
        sites.push(await assertionSite(context.analysis, call, ownership.owners));
        replacements.push(...await assertionChanges(context, call));
    }
    return { sites, replacements };
}

function checkerInsertionOffset(module: TranslatedModule, file: TypeScript.SourceFile): number {
    const first = file.statements[0];
    if (first === undefined) {
        throw new Error('Checker input has no source statements.');
    }
    const positions = mapSourceRange(module.mappings, { start: first.end, end: first.end }, 'original');
    if (positions.length === 0) {
        throw new Error('Cannot map checker import insertion.');
    }
    return Math.max(...positions.map(function end(range) {
        return range.end;
    }));
}

function translatedModule(
    file: TypeScript.SourceFile,
    replacements: readonly SourceReplacement[],
    expectName: string
): TranslatedModule {
    const identity: TranslatedModule = {
        path: file.fileName,
        originalText: file.text,
        text: file.text,
        mappings: [ {
            kind: 'copied',
            original: { start: 0, end: file.text.length },
            generated: { start: 0, end: file.text.length }
        } ]
    };
    const sorted = replacements.toSorted(function lastFirst(left, right) {
        return right.range.start - left.range.start;
    });
    sorted.forEach(function disjoint(change, index) {
        const previous = sorted[index - 1];
        if (previous !== undefined && change.range.end > previous.range.start) {
            throw new Error('Overlapping native assertion translations.');
        }
    });
    const translated = sorted.reduce(function replace(module, change) {
        return replaceMappedSource(module, change.range, change.fragments);
    }, identity);
    const offset = checkerInsertionOffset(translated, file);
    return replaceMappedText(
        translated,
        { start: offset, end: offset },
        `\nimport { expect as ${expectName} } from 'tstyche';\n`
    );
}

function bodyAnchor(origin: TestBodyOrigin): string {
    const location = resolveSourceLocation(origin.location);
    return location.kind === 'known'
        ? `${location.file}:${location.line}:${location.column}`
        : 'unknown source';
}

async function ownedBody(analysis: SourceAnalysis, testCase: TestPlan['cases'][number]): Promise<SourceBody> {
    if (testCase.bodyOrigin === null) {
        throw new Error('Selected type-test case has no callback source ownership.');
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
        const reason = error instanceof Error ? error.message : 'Unknown callback source.';
        throw new Error(
            `Cannot locate body of "${testCase.id.title}" at ${bodyAnchor(testCase.bodyOrigin)}: ${reason}`,
            { cause: error }
        );
    }
}

async function bodyOwnership(analysis: SourceAnalysis, plan: TestPlan): Promise<readonly BodyOwnership[]> {
    const bodies = new Map<SourceBody, string[]>();
    const selected = plan.cases.filter(function executable(testCase) {
        return testCase.execution.kind !== 'skip';
    });
    for (const testCase of selected) {
        const body = await ownedBody(analysis, testCase);
        const owners = bodies.get(body) ?? [];
        if (!owners.includes(caseKey(testCase))) {
            owners.push(caseKey(testCase));
        }
        bodies.set(body, owners);
    }
    return Array.from(bodies, function ownership([ body, owners ]) {
        return { body, owners };
    });
}

function fileOwnership(bodies: readonly BodyOwnership[]): ReadonlyMap<TypeScript.SourceFile, readonly BodyOwnership[]> {
    const files = new Map<TypeScript.SourceFile, BodyOwnership[]>();
    for (const ownership of bodies) {
        const entries = files.get(ownership.body.getSourceFile()) ?? [];
        entries.push(ownership);
        files.set(ownership.body.getSourceFile(), entries);
    }
    return files;
}

async function translateFile(
    analysis: SourceAnalysis,
    file: TypeScript.SourceFile,
    entries: readonly BodyOwnership[]
): Promise<NativeTranslation> {
    await rejectForeignCheckerBoundaries(analysis, file);
    let expectName = '__overkillTypeExpect';
    while (file.text.includes(expectName)) {
        expectName += '_';
    }
    const translations: BodyTranslation[] = [];
    for (const entry of entries) {
        translations.push(await translatedBody({ analysis, expectName }, entry));
    }
    return {
        sites: translations.flatMap(function sites(entry) {
            return entry.sites;
        }),
        modules: [ translatedModule(
            file,
            translations.flatMap(function changes(entry) {
                return entry.replacements;
            }),
            expectName
        ) ]
    };
}

export async function translateNativePlan(analysis: SourceAnalysis, plan: TestPlan): Promise<NativeTranslation> {
    const files = fileOwnership(await bodyOwnership(analysis, plan));
    const translations: NativeTranslation[] = [];
    for (const [ file, entries ] of files) {
        translations.push(await translateFile(analysis, file, entries));
    }
    return {
        modules: translations.flatMap(function modules(entry) {
            return entry.modules;
        }),
        sites: translations.flatMap(function sites(entry) {
            return entry.sites;
        })
    };
}
