import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { Store } from 'tstyche/api';
import type { CompilerSelection } from './checker.entry-point.ts';
import { parseProject } from './generated-module-plan.ts';
import { captureProjectInputs, verifyProjectInputs, sourceFingerprint, type FrozenInputs } from './frozen-inputs.ts';
import type { NativeTranslation } from './native-translation.ts';

type Compiler = NonNullable<Awaited<ReturnType<typeof Store.load>>>;
export type FrozenProject = {
    readonly inputs: FrozenInputs;
    readonly compiler: Compiler;
    readonly projectConfigPath: string;
    readonly projectText: string;
    readonly project: ReturnType<typeof parseProject>;
    readonly program: ReturnType<Compiler['createProgram']>;
};
export const fingerprint = sourceFingerprint;

async function selectedCompiler(selection: CompilerSelection): Promise<Compiler> {
    const target = selection.kind === 'local' ? '*' : selection.version;
    const selected = await Store.load(target);
    if (selected === undefined || selection.kind === 'version' && selected.version !== target) {
        throw new Error('Cannot load the expected exact compiler version.');
    }
    return selected;
}

async function pinnedCompiler(selected: Compiler): Promise<Compiler> {
    const compiler = await Store.load(selected.version);
    const selectedText = selected.sys.readFile(selected.sys.getExecutingFilePath());
    const exactText = compiler?.sys.readFile(compiler.sys.getExecutingFilePath());
    if (
        compiler === undefined || selectedText === undefined || exactText === undefined ||
        sourceFingerprint(selectedText) !== sourceFingerprint(exactText)
    ) {
        throw new Error('Selected compiler cannot be pinned to its exact version.');
    }
    return compiler;
}

export async function loadProject(projectPath: string, selection: CompilerSelection): Promise<FrozenProject> {
    const compiler = await pinnedCompiler(await selectedCompiler(selection));
    const projectConfigPath = resolve(projectPath);
    const { project, program, inputs } = captureProjectInputs(compiler, projectConfigPath);
    return {
        compiler,
        projectConfigPath,
        project,
        program,
        inputs,
        projectText: await readFile(projectConfigPath, 'utf8')
    };
}

function compilerOptions(project: ReturnType<typeof parseProject>): unknown {
    const { configFile, ...options } = project.options;
    return { options, files: project.fileNames, references: project.projectReferences };
}

export async function verifyFrozenProject(project: FrozenProject, translation: NativeTranslation): Promise<void> {
    const current = parseProject({
        compiler: project.compiler,
        projectConfigPath: project.projectConfigPath,
        modules: []
    });
    if (!isDeepStrictEqual(compilerOptions(current), compilerOptions(project.project))) {
        throw new Error('Type-test project configuration changed after collection.');
    }
    if (await readFile(project.projectConfigPath, 'utf8') !== project.projectText) {
        throw new Error('Type-test project configuration changed after collection.');
    }
    verifyProjectInputs(project.compiler, project.inputs);
    for (const module of translation.modules) {
        if (fingerprint(await readFile(module.path, 'utf8')) !== fingerprint(module.originalText)) {
            throw new Error(`Type-test source changed after collection: ${module.path}`);
        }
    }
}
