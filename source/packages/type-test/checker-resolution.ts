import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type TypeScript from 'typescript';

function pathBase(options: TypeScript.CompilerOptions): string {
    // eslint-disable-next-line sonarjs/deprecation -- Preserve existing project resolution while baseUrl remains supported.
    const { baseUrl } = options;
    if (baseUrl !== undefined) {
        return baseUrl;
    }
    if (typeof options.pathsBasePath === 'string') {
        return options.pathsBasePath;
    }
    if (typeof options.configFilePath === 'string') {
        return dirname(options.configFilePath);
    }
    throw new Error('Cannot establish the original project path mapping base.');
}

function checkerDeclarationPath(compiler: typeof TypeScript): string {
    const target = compiler
        .resolveModuleName(
            'tstyche',
            fileURLToPath(import.meta.url),
            { module: compiler.ModuleKind.NodeNext, moduleResolution: compiler.ModuleResolutionKind.NodeNext },
            compiler.sys,
            undefined,
            undefined,
            compiler.ModuleKind.ESNext
        )
        .resolvedModule;
    if (target?.resolvedFileName.endsWith('.d.ts') !== true) {
        throw new Error('Cannot resolve installed checker declarations.');
    }
    return target.resolvedFileName;
}

export function checkerCompilerOptions(
    compiler: typeof TypeScript,
    options: TypeScript.CompilerOptions
): TypeScript.CompilerOptions {
    const paths = Object.fromEntries(
        Object.entries(options.paths ?? {}).map(function absolutePaths([ name, values ]) {
            return [
                name,
                values.map(function absolutePath(value) {
                    return resolve(pathBase(options), value);
                })
            ];
        })
    );
    return {
        ...options,
        paths: { ...paths, tstyche: [ checkerDeclarationPath(compiler) ] }
    };
}

export function comparableCompilerOptions(compiler: typeof TypeScript, options: TypeScript.CompilerOptions): unknown {
    const { configFilePath, pathsBasePath, ...effective } = checkerCompilerOptions(compiler, options);
    return effective;
}
