import { createRequire } from 'node:module';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash } from 'node:crypto';
import { z } from 'zod';
import pLimit from 'p-limit';
import type * as NativeApi from 'typescript-beta/async';
import type * as Ast from 'typescript-beta/ast';
import type { CompilerSelection } from './profile-settings.ts';

type CompilerFile = {
    readonly path: string;
    readonly fingerprint: string;
};
type CompilerResolution = { readonly path: string; readonly target: string | null; };
type NativeModule = Pick<
    typeof NativeApi,
    'API' | 'DiagnosticCategory' | 'ModuleKind' | 'ModuleResolutionKind' | 'SymbolFlags' | 'TypeFlags'
>;
type NativeSyntax = Pick<
    NativeModule,
    'DiagnosticCategory' | 'ModuleKind' | 'ModuleResolutionKind' | 'SymbolFlags' | 'TypeFlags'
>;
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
    readonly resolutions: readonly CompilerResolution[];
};
type Installation = {
    readonly root: string;
    readonly packageUrl: string;
    readonly files: readonly CompilerFile[];
    readonly resolutions: readonly CompilerResolution[];
    readonly require: ReturnType<typeof createRequire>;
    readonly specifier: string;
};
const compilerReadConcurrency = 8;
const readCompilerFile = pLimit(compilerReadConcurrency);
const manifestSchema = z.object({ name: z.literal('typescript'), version: z.string() });
const loadedImplementations = new Map<string, string>();
const nativeSchema = z.custom<NativeModule>(function nativeModule(value) {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'API') === 'function' &&
        [ 'SymbolFlags', 'TypeFlags', 'ModuleKind', 'ModuleResolutionKind', 'DiagnosticCategory' ].every(
            function exported(name) {
                return typeof Reflect.get(value, name) === 'object';
            }
        );
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
    const contents = await readFile(path);
    return hash('sha256', contents);
}
async function compilerFile(path: string): Promise<CompilerFile> {
    return { path: await realpath(path), fingerprint: await fingerprint(path) };
}
async function compilerFiles(
    root: string,
    binaryManifestPath: string,
    signal: AbortSignal
): Promise<readonly CompilerFile[]> {
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
            signal.throwIfAborted();
            return compilerFile(path);
        });
    }));
}
async function resolutionTarget(path: string): Promise<string | null> {
    try {
        return await realpath(path);
    } catch (error: unknown) {
        if (error instanceof Error && [ 'ENOENT', 'ENOTDIR' ].includes(String(Reflect.get(error, 'code')))) {
            return null;
        }
        throw error;
    }
}

async function observeResolution(
    require: Readonly<Installation['require']>,
    specifier: string,
    manifest: string
): Promise<readonly CompilerResolution[]> {
    const resolutions: CompilerResolution[] = [];
    const candidates = (require.resolve.paths(specifier) ?? []).map(function packageManifest(directory) {
        return join(directory, specifier, 'package.json');
    });
    for (const path of candidates) {
        const target = await resolutionTarget(path);
        resolutions.push({ path, target });
        if (target === manifest) {
            return resolutions;
        }
        if (target !== null) {
            throw new Error('Compiler resolution changed after loading; restart the execution host.');
        }
    }
    throw new Error('Cannot verify the resolved compiler package from the project.');
}

async function verifyCompilerVersion(manifestPath: string, selection: CompilerSelection): Promise<void> {
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (selection.kind === 'package' && selection.version !== manifest.version) {
        throw new Error('Installed compiler does not match the requested exact version.');
    }
    if (manifest.version !== '7.1.0-beta') {
        throw new Error(`Unsupported TypeScript compiler: ${manifest.version}; expected 7.1.0-beta.`);
    }
}

async function installation(
    projectRoot: string,
    selection: CompilerSelection,
    signal: AbortSignal
): Promise<Installation> {
    const require = createRequire(pathToFileURL(resolve(projectRoot, 'package.json')));
    const specifier = selection.kind === 'local' ? 'typescript' : selection.specifier;
    const manifestPath = await realpath(require.resolve(`${specifier}/package.json`));
    await verifyCompilerVersion(manifestPath, selection);
    const root = dirname(manifestPath);
    const nativeSpecifier = `@typescript/typescript-${process.platform}-${process.arch}`;
    const compilerRequire = createRequire(manifestPath);
    const nativeManifest = await realpath(compilerRequire.resolve(`${nativeSpecifier}/package.json`));
    const resolutions = [
        ...await observeResolution(require, specifier, manifestPath),
        ...await observeResolution(compilerRequire, nativeSpecifier, nativeManifest)
    ];
    return {
        root,
        resolutions,
        packageUrl: pathToFileURL(`${root}/`).href,
        files: await compilerFiles(root, nativeManifest, signal),
        require,
        specifier
    };
}
function verifyLoadedImplementation(input: Installation): void {
    const loaded = loadedImplementations.get(input.packageUrl);
    if (loaded !== undefined && loaded !== JSON.stringify(input.files)) {
        throw new Error('Compiler implementation changed after loading; restart the execution host.');
    }
}
async function verifyCompilerResolution(
    compiler: InstalledCompiler,
    signal: AbortSignal
): Promise<void> {
    for (const entry of compiler.resolutions) {
        signal.throwIfAborted();
        if (await resolutionTarget(entry.path) !== entry.target) {
            throw new Error('Compiler resolution changed after preparation.');
        }
    }
}

async function verifyCompilerContents(compiler: InstalledCompiler, signal: AbortSignal): Promise<void> {
    await Promise.all(compiler.files.map(async function verify(file) {
        return readCompilerFile(async function verifyFingerprint() {
            signal.throwIfAborted();
            if (await fingerprint(file.path) !== file.fingerprint) {
                throw new Error('Compiler implementation changed after preparation.');
            }
        });
    }));
}
export async function verifyInstalledCompiler(compiler: InstalledCompiler, signal: AbortSignal): Promise<void> {
    const results = await Promise.allSettled([
        verifyCompilerResolution(compiler, signal),
        verifyCompilerContents(compiler, signal)
    ]);
    for (const result of results) {
        if (result.status === 'rejected') {
            throw result.reason;
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
        DiagnosticCategory: native.DiagnosticCategory,
        ModuleKind: native.ModuleKind,
        ModuleResolutionKind: native.ModuleResolutionKind,
        isTypeAssertionExpression: ast.isTypeAssertion,
        isStringLiteralLike: ast.isStringLiteralLikeNode,
        isFunctionLike: ast.isFunctionLikeDeclaration
    };
    return {
        syntax,
        native,
        version: '7.1.0-beta',
        packageUrl: input.packageUrl,
        files: input.files,
        resolutions: input.resolutions
    };
}
export async function resolveInstalledCompiler(
    projectRoot: string,
    selection: CompilerSelection,
    signal: AbortSignal
): Promise<InstalledCompiler> {
    const input = await installation(projectRoot, selection, signal);
    verifyLoadedImplementation(input);
    const compiler = await loadCompiler(input);
    await verifyInstalledCompiler(compiler, signal);
    loadedImplementations.set(input.packageUrl, JSON.stringify(input.files));
    return compiler;
}
