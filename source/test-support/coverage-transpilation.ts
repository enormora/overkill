import { z } from 'zod/v4';

type CoverageCompilerOptions = {
    readonly compilerOptions: { readonly module: number; readonly sourceMap: boolean; readonly target: number; };
    readonly fileName: string;
};
type CoverageCompiler = {
    readonly ModuleKind: { readonly ESNext: number; };
    readonly ScriptTarget: { readonly ESNext: number; };
    readonly transpileModule: (source: string, options: CoverageCompilerOptions) => unknown;
};
const compilerOutputSchema = z.object({ outputText: z.string(), sourceMapText: z.string() });

type CoverageTranspilationOptions = {
    readonly filePath: string;
    readonly sourceMapOptions: { readonly compiledFilename: string; };
};
type CoverageTranspilation = {
    readonly code: string;
    readonly sourceMap: Readonly<Record<string, unknown>>;
};

export function createCoverageTranspiler(
    compiler: CoverageCompiler
): (source: string, options: CoverageTranspilationOptions) => CoverageTranspilation {
    return function transpileCoverageFixture(source, options) {
        const output = compilerOutputSchema.parse(compiler.transpileModule(source, {
            compilerOptions: {
                module: compiler.ModuleKind.ESNext,
                sourceMap: true,
                target: compiler.ScriptTarget.ESNext
            },
            fileName: options.filePath
        }));
        const sourceMap = z.record(z.string(), z.unknown()).parse(JSON.parse(output.sourceMapText));

        return {
            code: output.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/mu, '\n'),
            sourceMap: { ...sourceMap, file: options.sourceMapOptions.compiledFilename }
        };
    };
}
