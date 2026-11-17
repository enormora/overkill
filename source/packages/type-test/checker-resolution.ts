import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type * as CompilerApi from 'typescript-beta/async';
import type { CompilerSyntax } from './installed-compiler.ts';

function pathBase(options: CompilerApi.CompilerOptions): string {
    const base: unknown = Reflect.get(options, 'pathsBasePath');
    if (typeof base === 'string') {
        return base;
    }
    if (options.configFilePath !== undefined) {
        return dirname(options.configFilePath);
    }
    throw new Error('Cannot establish original path mapping base.');
}

export function checkerCompilerOptions(
    _compiler: CompilerSyntax,
    options: CompilerApi.CompilerOptions
): CompilerApi.CompilerOptions {
    const paths = Object.fromEntries(
        Object.entries(options.paths ?? {}).map(function absolutePaths([ name, values ]) {
            return [
                name,
                values.map(function absolutePath(path) {
                    return resolve(pathBase(options), path);
                })
            ];
        })
    );
    return {
        ...options,
        paths: {
            ...paths,
            tstyche: [ fileURLToPath(new URL('./dist/index.d.ts', import.meta.resolve('tstyche/package.json'))) ]
        }
    };
}

export function comparableCompilerOptions(compiler: CompilerSyntax, options: CompilerApi.CompilerOptions): unknown {
    return Object.fromEntries(
        Object.entries(checkerCompilerOptions(compiler, options)).filter(function effective([ name ]) {
            return name !== 'configFilePath' && name !== 'pathsBasePath';
        })
    );
}
