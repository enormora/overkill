import type * as TypeScript from 'typescript';
import type { ImportDiagnostic, RepairedModule } from './generated-imports.ts';
import type { SourceRange, TranslatedModule } from './generated-source.ts';

export type GeneratedInputRequest = {
    readonly compiler: typeof TypeScript;
    readonly projectConfigPath: string;
    readonly modules: readonly TranslatedModule[];
};
export type GeneratedProvenance = {
    readonly originalPath: string;
    readonly generatedPath: string;
    readonly originalFingerprint: string;
    readonly generatedFingerprint: string;
    readonly mappings: TranslatedModule['mappings'];
    readonly repairs: RepairedModule['repairs'];
    readonly limitations: readonly string[];
};
export type GeneratedModuleResult = {
    readonly kind: 'ambiguous';
    readonly originalPath: string;
    readonly diagnostics: readonly ImportDiagnostic[];
} | {
    readonly kind: 'ready';
    readonly path: string;
    readonly provenance: GeneratedProvenance;
};
export type GeneratedInputBatch = {
    readonly modules: readonly GeneratedModuleResult[];
    readonly mapRange: (
        path: string,
        range: SourceRange,
        direction: 'generated' | 'original'
    ) => readonly SourceRange[];
};
