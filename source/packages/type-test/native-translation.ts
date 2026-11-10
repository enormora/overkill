import type TypeScript from 'typescript';
import { resolveSourceLocation, type TestBodyOrigin, type TestPlan } from '../engine/engine.entry-point.ts';
import { rejectForeignCheckerBoundaries } from './checker-boundary-validation.ts';
import type { SourceAnalysis } from './source-analysis.ts';
import {
    replaceMappedSource,
    replaceMappedText,
    mapSourceRange,
    type TranslatedModule,
    type SourceRange
} from './generated-source.ts';
import { resolveBodyOrigin, namedBodyParameter, type SourceBody } from './source-ownership.ts';
import { nativeReference, type NativeReference } from './native-reference.ts';
import { referenceExpression, needsTypeSubject } from './native-reference-expression.ts';
import { decoratorReplacements, type SourceReplacement } from './decorator-translation.ts';
import { scopeAssertions, assertionAnnotation } from './scope-assertions.ts';

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
type BodyOwnership = { readonly body: SourceBody; readonly owners: readonly string[]; };
type BodyTranslation = {
    readonly needsSubjectAlias: boolean;
    readonly sites: readonly NativeSite[];
    readonly replacements: readonly SourceReplacement[];
};
type AssertionContext = { readonly analysis: SourceAnalysis; readonly expectName: string; };

export function caseKey(testCase: TestPlan['cases'][number]): string {
    return JSON.stringify([ testCase.id.file, testCase.id.suite, testCase.id.title, testCase.id.params ]);
}

function assertionSite(
    analysis: SourceAnalysis,
    call: TypeScript.CallExpression,
    owners: readonly string[]
): NativeSite {
    const file = call.getSourceFile();
    const range = { start: call.getStart(file), end: call.end };
    const position = file.getLineAndCharacterOfPosition(range.start);
    return {
        path: file.fileName,
        range,
        owners,
        message: assertionAnnotation(analysis, call),
        line: position.line + 1,
        column: position.character + 1
    };
}

const decoratorAssertionOperands = 2;

function declarationChanges(
    context: AssertionContext,
    call: TypeScript.CallExpression,
    reference: NativeReference
): readonly SourceReplacement[] {
    const declaration = call.arguments[1];
    if (declaration === undefined || call.arguments.length !== decoratorAssertionOperands) {
        throw new Error('Decorator assertions require exactly one declaration callback.');
    }
    return decoratorReplacements(context.analysis, declaration, reference, context.expectName);
}

function validateAssertionSyntax(context: AssertionContext, call: TypeScript.CallExpression): void {
    if (call.typeArguments !== undefined || call.arguments.some(context.analysis.compiler.isSpreadElement)) {
        throw new Error('Explicit assertion type arguments and spread operands are unsupported.');
    }
}

function assertionChanges(context: AssertionContext, call: TypeScript.CallExpression): readonly SourceReplacement[] {
    validateAssertionSyntax(context, call);
    const referenceNode = call.arguments[0];
    if (referenceNode === undefined) {
        throw new Error('Native assertion is missing its reference.');
    }
    const reference = nativeReference(context.analysis, referenceNode);
    if (reference.kind === 'decorator') {
        return declarationChanges(context, call, reference);
    }
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

function assertionNeedsTypeSubject(analysis: SourceAnalysis, call: TypeScript.CallExpression): boolean {
    const reference = call.arguments[0];
    return reference !== undefined && needsTypeSubject(nativeReference(analysis, reference));
}

function translatedBody(context: AssertionContext, ownership: BodyOwnership): BodyTranslation {
    const scopeParameter = namedBodyParameter(context.analysis, ownership.body);
    const calls = scopeAssertions(context.analysis, ownership.body, scopeParameter);
    return {
        sites: calls.map(function site(call) {
            return assertionSite(context.analysis, call, ownership.owners);
        }),
        replacements: calls.flatMap(function changes(call) {
            return assertionChanges(context, call);
        }),
        needsSubjectAlias: calls.some(function typedSubject(call) {
            return assertionNeedsTypeSubject(context.analysis, call);
        })
    };
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
    expectName: string,
    needsSubjectAlias: boolean
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
    const declaration = needsSubjectAlias ? `type ${expectName}Subject<Subject> = Subject;\n` : '';
    const offset = checkerInsertionOffset(translated, file);
    return replaceMappedText(
        translated,
        { start: offset, end: offset },
        `\nimport { expect as ${expectName} } from 'tstyche';\n${declaration}`
    );
}

function bodyAnchor(origin: TestBodyOrigin): string {
    const location = resolveSourceLocation(origin.location);
    return location.kind === 'known'
        ? `${location.file}:${location.line}:${location.column}`
        : 'unknown source';
}

function ownedBody(analysis: SourceAnalysis, testCase: TestPlan['cases'][number]): SourceBody {
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
        return resolveBodyOrigin(analysis, testCase.bodyOrigin);
    } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : 'Unknown callback source.';
        throw new Error(
            `Cannot locate body of "${testCase.id.title}" at ${bodyAnchor(testCase.bodyOrigin)}: ${reason}`,
            { cause: error }
        );
    }
}

function bodyOwnership(analysis: SourceAnalysis, plan: TestPlan): readonly BodyOwnership[] {
    const bodies = new Map<SourceBody, string[]>();
    const selected = plan.cases.filter(function executable(testCase) {
        return testCase.execution.kind !== 'skip';
    });
    for (const testCase of selected) {
        const body = ownedBody(analysis, testCase);
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

function translateFile(
    analysis: SourceAnalysis,
    file: TypeScript.SourceFile,
    entries: readonly BodyOwnership[]
): NativeTranslation {
    rejectForeignCheckerBoundaries(analysis, file);
    let expectName = '__overkillTypeExpect';
    while (file.text.includes(expectName)) {
        expectName += '_';
    }
    const translations = entries.map(function translate(entry) {
        return translatedBody({ analysis, expectName }, entry);
    });
    return {
        sites: translations.flatMap(function sites(entry) {
            return entry.sites;
        }),
        modules: [ translatedModule(
            file,
            translations.flatMap(function changes(entry) {
                return entry.replacements;
            }),
            expectName,
            translations.some(function typedSubject(entry) {
                return entry.needsSubjectAlias;
            })
        ) ]
    };
}

export function translateNativePlan(analysis: SourceAnalysis, plan: TestPlan): NativeTranslation {
    const files = fileOwnership(bodyOwnership(analysis, plan));
    const translations = Array.from(files, function translate([ file, entries ]) {
        return translateFile(analysis, file, entries);
    });
    return {
        modules: translations.flatMap(function modules(entry) {
            return entry.modules;
        }),
        sites: translations.flatMap(function sites(entry) {
            return entry.sites;
        })
    };
}
