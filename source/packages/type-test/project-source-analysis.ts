import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Symbol as CompilerSymbol } from 'typescript-beta/async';
import type { FrozenProject } from './frozen-project.ts';
import { compilerFileSystem } from './compiler-file-system.ts';
import { createSourceAnalysis, type SourceAnalysis } from './source-analysis-port.ts';

const entryExtension = import.meta.url.endsWith('.ts') ? '.ts' : '.d.ts';
const relationEntry = fileURLToPath(new URL(`./type-test.entry-point${entryExtension}`, import.meta.url));

async function relationModuleExports(project: FrozenProject): Promise<readonly CompilerSymbol[]> {
    const { checker } = project;
    const direct = await checker.getSymbolOfSourceFile(relationEntry);
    if (direct !== undefined) {
        return await checker.getExportsOfModule(direct);
    }
    const realpath = compilerFileSystem.realpath(relationEntry);
    const names = await project.program.getSourceFileNames();
    const matchingFiles = names.filter(function sameEntry(name) {
        return basename(name) === basename(relationEntry) && compilerFileSystem.realpath(name) === realpath;
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
        projectConfigPath: project.projectConfigPath,
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
