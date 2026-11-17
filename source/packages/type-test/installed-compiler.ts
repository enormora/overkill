import { createRequire } from 'node:module';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import pLimit from 'p-limit';
import type * as NativeApi from 'typescript-beta/async';
import type * as Ast from 'typescript-beta/ast';
import type { CompilerSelection } from './profile-settings.ts';

type CompilerFile = {
    readonly path: string;
    readonly fingerprint: string;
};
type NativeModule = Pick<typeof NativeApi, 'API' | 'ModuleKind' | 'ModuleResolutionKind' | 'SymbolFlags' | 'TypeFlags'>;
type NativeSyntax = Pick<NativeModule, 'ModuleKind' | 'ModuleResolutionKind' | 'SymbolFlags' | 'TypeFlags'>;
type SyntaxAliases = {
    readonly isTypeAssertionExpression: typeof Ast.isTypeAssertion;
    readonly isStringLiteralLike: typeof Ast.isStringLiteralLikeNode;
    readonly isFunctionLike: typeof Ast.isFunctionLikeDeclaration;
};
export type CompilerSyntax = Readonly<NativeSyntax & SyntaxAliases & typeof Ast>;
export type InstalledCompiler = {
    readonly syntax: CompilerSyntax;
    readonly native: NativeModule;
    readonly version: string;
    readonly packageUrl: string;
    readonly files: readonly CompilerFile[];
};
type Installation = {
    readonly root: string;
    readonly packageUrl: string;
    readonly files: readonly CompilerFile[];
    readonly require: ReturnType<typeof createRequire>;
    readonly specifier: string;
};
const compilerReadConcurrency = 8;
const readCompilerFile = pLimit(compilerReadConcurrency);
const manifestSchema = z.object({ name: z.literal('typescript'), version: z.string() });
const loadedImplementations = new Map<string, string>();
const nativeSchema = z.custom<NativeModule>(function nativeModule(value) {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'API') === 'function' &&
        [ 'SymbolFlags', 'TypeFlags', 'ModuleKind', 'ModuleResolutionKind' ].every(function exported(name) {
            return typeof Reflect.get(value, name) === 'object';
        });
});
const syntaxSchema = z.custom<typeof Ast>(function syntaxModule(value) {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'SyntaxKind') === 'object' &&
        [ 'isIdentifier', 'isTypeAssertion', 'isStringLiteralLikeNode', 'isFunctionLikeDeclaration' ].every(
            function exported(name) {
                return typeof Reflect.get(value, name) === 'function';
            }
        );
});
async function fingerprint(path: string): Promise<string> {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}
async function compilerFile(path: string): Promise<CompilerFile> {
    return { path: await realpath(path), fingerprint: await fingerprint(path) };
}
async function compilerFiles(root: string): Promise<readonly CompilerFile[]> {
    const require = createRequire(pathToFileURL(join(root, 'package.json')));
    const binaryManifestPath = require.resolve(
        `@typescript/typescript-${process.platform}-${process.arch}/package.json`
    );
    z.object({ version: z.literal('7.1.0-beta') }).parse(JSON.parse(await readFile(binaryManifestPath, 'utf8')));
    const executable = join(dirname(binaryManifestPath), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const paths = entries
        .filter(function implementation(entry) {
            return entry.isFile() && /\.(?:js|cjs|json|ts)$/u.test(entry.name);
        })
        .map(function implementationPath(entry) {
            return join(entry.parentPath, entry.name);
        });
    const unique = Array.from(new Set([ binaryManifestPath, executable, ...paths ])).toSorted(
        function byPath(left, right) {
            return left.localeCompare(right);
        }
    );
    return await Promise.all(unique.map(async function readImplementation(path) {
        return readCompilerFile(async function () {
            return compilerFile(path);
        });
    }));
}
async function installation(projectRoot: string, selection: CompilerSelection): Promise<Installation> {
    const require = createRequire(pathToFileURL(resolve(projectRoot, 'package.json')));
    const specifier = selection.kind === 'local' ? 'typescript' : selection.specifier;
    const manifestPath = await realpath(require.resolve(`${specifier}/package.json`));
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (selection.kind === 'package' && selection.version !== manifest.version) {
        throw new Error('Installed compiler does not match the requested exact version.');
    }
    if (manifest.version !== '7.1.0-beta') {
        throw new Error(`Unsupported TypeScript compiler: ${manifest.version}; expected 7.1.0-beta.`);
    }
    const root = dirname(manifestPath);
    return { root, packageUrl: pathToFileURL(`${root}/`).href, files: await compilerFiles(root), require, specifier };
}
function verifyLoadedImplementation(input: Installation): void {
    const loaded = loadedImplementations.get(input.packageUrl);
    if (loaded !== undefined && loaded !== JSON.stringify(input.files)) {
        throw new Error('Compiler implementation changed after loading; restart the execution host.');
    }
}
export async function verifyInstalledCompiler(compiler: InstalledCompiler): Promise<void> {
    for (const file of compiler.files) {
        if (await fingerprint(file.path) !== file.fingerprint) {
            throw new Error('Compiler implementation changed after preparation.');
        }
    }
}
async function loadCompiler(input: Installation): Promise<InstalledCompiler> {
    const native = nativeSchema.parse(
        await import(pathToFileURL(input.require.resolve(`${input.specifier}/async`)).href)
    );
    const ast = syntaxSchema.parse(await import(pathToFileURL(input.require.resolve(`${input.specifier}/ast`)).href));
    const reported: unknown = await import(pathToFileURL(input.require.resolve(input.specifier)).href);
    z.object({ version: z.literal('7.1.0-beta') }).parse(reported);
    const syntax = {
        ...ast,
        SymbolFlags: native.SymbolFlags,
        TypeFlags: native.TypeFlags,
        ModuleKind: native.ModuleKind,
        ModuleResolutionKind: native.ModuleResolutionKind,
        isTypeAssertionExpression: ast.isTypeAssertion,
        isStringLiteralLike: ast.isStringLiteralLikeNode,
        isFunctionLike: ast.isFunctionLikeDeclaration
    };
    return { syntax, native, version: '7.1.0-beta', packageUrl: input.packageUrl, files: input.files };
}
export async function resolveInstalledCompiler(
    projectRoot: string,
    selection: CompilerSelection
): Promise<InstalledCompiler> {
    const input = await installation(projectRoot, selection);
    verifyLoadedImplementation(input);
    const compiler = await loadCompiler(input);
    await verifyInstalledCompiler(compiler);
    loadedImplementations.set(input.packageUrl, JSON.stringify(input.files));
    return compiler;
}
