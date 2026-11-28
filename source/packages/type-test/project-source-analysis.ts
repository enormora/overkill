import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Symbol as CompilerSymbol } from 'typescript-beta/async';
import type { FrozenProject } from './frozen-project.ts';
import { compilerFileSystem } from './compiler-file-system.ts';
import { createSourceAnalysis, type SourceAnalysis } from './source-analysis-port.ts';

const entryExtension = import.meta.url.endsWith('.ts') ? '.ts' : '.d.ts';
const relationEntry = fileURLToPath(new URL(`./type-test.entry-point${entryExtension}`, import.meta.url));
const relationPackage = '@overkill-dev/type-test';

async function relationEntries(project: FrozenProject): Promise<readonly string[]> {
    if (entryExtension === '.d.ts') {
        return [ relationEntry ];
    }
    const resolutions = await Promise.all(project.project.fileNames.map(async function resolveAuthoring(file) {
        return await project.program.getResolvedModule(
            file,
            relationPackage,
            project.compiler.syntax.ModuleKind.ESNext
        );
    }));
    return [
        relationEntry,
        ...resolutions.flatMap(function publishedEntry(resolution) {
            return resolution?.packageId?.name === relationPackage ? [ resolution.resolvedFileName ] : [];
        })
    ];
}

async function relationModuleExports(project: FrozenProject): Promise<readonly CompilerSymbol[]> {
    const { checker } = project;
    const entries = await relationEntries(project);
    const paths = new Set(entries.map(compilerFileSystem.realpath));
    const basenames = new Set(entries.map(function entryName(path) {
        return basename(path);
    }));
    const names = await project.program.getSourceFileNames();
    const matchingFiles = names.filter(function sameEntry(name) {
        return basenames.has(basename(name)) && paths.has(compilerFileSystem.realpath(name));
    });
    const modules = await checker.getSymbolOfSourceFile(matchingFiles);
    const exports = await Promise.all(modules.map(async function exported(symbol) {
        return symbol === undefined ? [] : await checker.getExportsOfModule(symbol);
    }));
    return exports.flat();
}

export function projectSourceAnalysis(project: FrozenProject): SourceAnalysis {
    const { checker } = project;
    return createSourceAnalysis({
        getRelationModuleExports: async function readExports() {
            return await relationModuleExports(project);
        },
        realpath: compilerFileSystem.realpath,
        compiler: project.compiler.syntax,
        program: project.program,
        checker: {
            getSymbolAtLocation: checker.getSymbolAtLocation.bind(checker),
            getAliasedSymbol: checker.getAliasedSymbol.bind(checker),
            getShorthandAssignmentValueSymbol: checker.getShorthandAssignmentValueSymbol.bind(checker),
            async getResolvedSignature(node) {
                const signature = await checker.getResolvedSignature(node);
                return { declaration: signature.declaration };
            },
            async staticString(node) {
                const value = await checker.getTypeAtLocation(node);
                return value.isStringLiteralType() ? value.value : null;
            }
        }
    });
}
