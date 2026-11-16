import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import ts from 'typescript';
import type { DeliveredModule } from './module-loading-scope.ts';

export type ImplementationPackage = { readonly url: string; readonly source: string; };

function executableImport(node: ts.Node): boolean {
    if (ts.isExportDeclaration(node)) {
        return !node.isTypeOnly;
    }
    if (!ts.isImportDeclaration(node)) {
        return false;
    }
    return node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword;
}

function declaredImport(node: ts.Node): string | null {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
        return null;
    }
    const specifier = node.moduleSpecifier;
    return executableImport(node) && specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : null;
}

function dynamicImport(node: ts.Node): string | null {
    if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
        return null;
    }
    const specifier = node.arguments[0];
    return specifier !== undefined && ts.isStringLiteralLike(specifier) ? specifier.text : null;
}

export function implementationImports(source: string, url: string): readonly string[] {
    const file = ts.createSourceFile(url, source, ts.ScriptTarget.Latest, true);
    const imports = new Set<string>();
    function visit(node: ts.Node): void {
        const specifier = declaredImport(node) ?? dynamicImport(node);
        if (specifier !== null) {
            imports.add(specifier);
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    return Array.from(imports).toSorted(function bySpecifier(left, right) {
        return left.localeCompare(right, 'en');
    });
}

async function packageSource(directory: string): Promise<ImplementationPackage | null> {
    const file = join(directory, 'package.json');
    try {
        return { url: pathToFileURL(file).href, source: await readFile(file, 'utf8') };
    } catch (error: unknown) {
        if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
            return null;
        }
        throw error;
    }
}

function* packageDirectories(url: string): Generator<string, void, unknown> {
    let directory = dirname(fileURLToPath(url));
    yield directory;
    while (directory !== dirname(directory)) {
        directory = dirname(directory);
        yield directory;
    }
}

export async function implementationPackages(url: string): Promise<readonly ImplementationPackage[]> {
    const packages = await Promise.all(Array.from(packageDirectories(url), packageSource));
    return packages.filter(function foundPackage(metadata): metadata is ImplementationPackage {
        return metadata !== null;
    });
}

const fixedFormats = new Map<string, DeliveredModule['format']>([
    [ '.json', 'json' ],
    [ '.mts', 'module-typescript' ],
    [ '.mjs', 'module' ]
]);

function hasModulePackage(packages: readonly ImplementationPackage[]): boolean {
    const nearest = packages[0];
    if (nearest === undefined) {
        return false;
    }
    return z.object({ type: z.string().default('commonjs') }).parse(JSON.parse(nearest.source)).type === 'module';
}

export function implementationFormat(
    url: string,
    packages: readonly ImplementationPackage[]
): DeliveredModule['format'] {
    const extension = extname(fileURLToPath(url));
    const fixed = fixedFormats.get(extension);
    if (fixed !== undefined) {
        return fixed;
    }
    if (!hasModulePackage(packages) || ![ '.ts', '.js' ].includes(extension)) {
        throw new TypeError(`Unsupported portable implementation format: ${url}`);
    }
    return extension === '.ts' ? 'module-typescript' : 'module';
}
