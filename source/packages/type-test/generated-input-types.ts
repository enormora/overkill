import type { CompilerSyntax } from './installed-compiler.ts';
import type { FrozenProject } from './frozen-project.ts';
import type { ImportDiagnostic, RepairedModule } from './generated-imports.ts';
import type { SourceRange, TranslatedModule } from './generated-source.ts';

export type GeneratedInputRequest = {
    readonly compiler: CompilerSyntax;
    readonly project: FrozenProject;
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
