import type { Diagnostic } from 'tstyche/api';
import type { ReadonlyDeep } from 'type-fest';
import type { CheckerRun } from './checker.entry-point.ts';
import type { NativeTranslation } from './native-translation.ts';

type DiagnosticLocation = {
    readonly file: string;
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
};
export type CheckerDiagnostic = {
    readonly code: string | null;
    readonly text: string;
    readonly location: DiagnosticLocation | null;
    readonly related: readonly CheckerDiagnostic[];
};
type DiagnosticContext = { readonly check: CheckerRun; readonly translation: NativeTranslation; };

function originalPosition(
    context: DiagnosticContext,
    origin: ReadonlyDeep<NonNullable<Diagnostic['origin']>>,
    file: string,
    start: number
): DiagnosticLocation {
    const text = context
        .translation
        .modules
        .find(function original(entry) {
            return entry.path === file;
        })
        ?.originalText;
    if (text === undefined) {
        const position = origin.sourceFile.getLineAndCharacterOfPosition(start);
        return { file, start, end: origin.end, line: position.line + 1, column: position.character + 1 };
    }
    const lines = text.slice(0, start).split(/\r\n|\r|\n/u);
    return { file, start, end: origin.end, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function originalPath(context: DiagnosticContext, generated: string): string {
    const module = context.check.inputs.modules.find(function generatedInput(entry) {
        return entry.kind === 'ready' && entry.path === generated;
    });
    return module?.kind === 'ready' ? module.provenance.originalPath : generated;
}

function originalLocation(
    context: DiagnosticContext,
    origin: ReadonlyDeep<NonNullable<Diagnostic['origin']>>
): DiagnosticLocation {
    const generated = origin.sourceFile.fileName;
    const file = originalPath(context, generated);
    const ranges = context.check.inputs.mapRange(generated, { start: origin.start, end: origin.end }, 'generated');
    const start = ranges[0]?.start ?? origin.start;
    return { ...originalPosition(context, origin, file, start), end: ranges.at(-1)?.end ?? origin.end };
}

export function checkerDiagnostic(context: DiagnosticContext, diagnostic: ReadonlyDeep<Diagnostic>): CheckerDiagnostic {
    return {
        code: diagnostic.code ?? null,
        text: typeof diagnostic.text === 'string' ? diagnostic.text : diagnostic.text.join('\n'),
        location: diagnostic.origin === undefined ? null : originalLocation(context, diagnostic.origin),
        related: diagnostic.related?.map(function related(entry) {
            return checkerDiagnostic(context, entry);
        }) ?? []
    };
}

export function checkerDiagnosticText(diagnostic: CheckerDiagnostic): string {
    const { location } = diagnostic;
    const prefix = location === null ? '' : `${location.file}:${location.line}:${location.column}: `;
    return [ prefix + diagnostic.text, ...diagnostic.related.map(checkerDiagnosticText) ].join('\n');
}
