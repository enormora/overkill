import { createRequire } from 'node:module';
import { cp, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { flattenDiagnosticMessageText, getPreEmitDiagnostics, type Program } from 'typescript';

const compilerDirectory = resolve('target/package-smoke/compiler');
export const consumerCompilerTypes = {
    types: [ 'node' ],
    typeRoots: [ join(compilerDirectory, 'node_modules/@types') ]
};

export async function installConsumerTypes(): Promise<void> {
    const require = createRequire(import.meta.url);
    const nodeManifest = require.resolve('@types/node/package.json');
    const nodeDependencies = createRequire(nodeManifest);
    const modules = join(compilerDirectory, 'node_modules');
    await mkdir(join(modules, '@types'), { recursive: true });
    await Promise.all([
        cp(dirname(nodeManifest), join(modules, '@types/node'), { recursive: true }),
        cp(dirname(nodeDependencies.resolve('undici-types/package.json')), join(modules, 'undici-types'), {
            recursive: true
        })
    ]);
}

export async function consumerTypeDiagnostics(program: Program, directory: string): Promise<readonly string[]> {
    const roots = await Promise.all(
        [ directory, join(directory, 'node_modules'), compilerDirectory ].map(async function canonicalRoot(root) {
            return await realpath(root);
        })
    );
    const files = await Promise.all(
        program
            .getSourceFiles()
            .filter(function consumerSource(source) {
                return !program.isSourceFileDefaultLibrary(source);
            })
            .map(async function canonicalSource(source) {
                return await realpath(source.fileName);
            })
    );
    for (const file of files) {
        if (
            !roots.some(function containsConsumer(root) {
                const location = relative(root, file);
                return !isAbsolute(location) && location.split(sep)[0] !== '..';
            })
        ) {
            throw new Error(`TypeScript resolved an uninstalled declaration: ${file}`);
        }
    }
    return getPreEmitDiagnostics(program).map(function diagnosticMessage(diagnostic) {
        return flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    });
}
