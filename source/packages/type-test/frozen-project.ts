import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Except } from 'type-fest';
import type { API, Snapshot, Project, ParsedCommandLine } from 'typescript-beta/async';
import { createCompilerLifetime } from './compiler-lifetime.ts';
import type { CompilerSelection } from './profile-settings.ts';
import { resolveInstalledCompiler, verifyInstalledCompiler, type InstalledCompiler } from './installed-compiler.ts';
import {
    observeProjectInputs,
    verifyProjectInputs,
    sourceFingerprint,
    type FrozenInputs,
    type ProjectInputObservation
} from './frozen-inputs.ts';
import type { OriginalAssertionPlan } from './original-assertions.ts';
import { createSourceAnalysis, type SourceAnalysis } from './source-analysis-port.ts';
import type { TypeAnalysis } from './type-analysis.ts';
import { compilerFileSystem } from './compiler-file-system.ts';

export type FrozenProject = {
    readonly compiler: InstalledCompiler;
    readonly api: API;
    readonly snapshot: Snapshot;
    readonly configured: Project;
    readonly projectConfigPath: string;
    readonly project: ParsedCommandLine;
    readonly program: Project['program'];
    readonly inputs: FrozenInputs;
    readonly projectText: string;
    readonly ownership: AsyncDisposableStack;
};
type ProjectSession = {
    readonly compiler: InstalledCompiler;
    readonly api: API;
    readonly projectConfigPath: string;
    readonly observation: ProjectInputObservation;
    readonly ownership: AsyncDisposableStack;
};
export const fingerprint = sourceFingerprint;
function configuredProject(snapshot: Snapshot, path: string): Project {
    const project = snapshot.getConfiguredProject(path);
    if (project === undefined) {
        throw new Error('Original configured project is unavailable.');
    }
    return project;
}

async function captureProject(input: ProjectSession): Promise<Except<FrozenProject, 'ownership'>> {
    const project = await input.api.parseConfigFile(input.projectConfigPath);
    if (project.errors.length > 0) {
        throw new Error(`Cannot parse original project: ${input.projectConfigPath}`, { cause: project.errors });
    }
    const snapshot = input.ownership.use(await input.api.createSnapshot({ openProjects: [ input.projectConfigPath ] }));
    const configured = configuredProject(snapshot, input.projectConfigPath);
    const paths = await configured.program.getSourceFileNames();
    for (const path of paths) {
        input.observation.fs.realpath(path);
    }
    return {
        compiler: input.compiler,
        api: input.api,
        snapshot,
        configured,
        projectConfigPath: input.projectConfigPath,
        project,
        program: configured.program,
        inputs: input.observation.snapshot(),
        projectText: await readFile(input.projectConfigPath, 'utf8')
    };
}

export async function loadProject(
    projectPath: string,
    selection: CompilerSelection,
    projectRoot: string
): Promise<FrozenProject> {
    const compiler = await resolveInstalledCompiler(projectRoot, selection);
    await using ownership = new AsyncDisposableStack();
    const observation = observeProjectInputs();
    const lifetime = ownership.use(createCompilerLifetime());
    const api = ownership.use(lifetime.run(function openCompiler() {
        return new compiler.native.API({ cwd: projectRoot, fs: observation.fs, runExternalCode: false });
    }));
    const project = await lifetime.run(async function capture() {
        return await captureProject({
            compiler,
            api,
            observation,
            ownership,
            projectConfigPath: resolve(projectRoot, projectPath)
        });
    });
    return { ...project, ownership: ownership.move() };
}

export function sourceAnalysis(project: FrozenProject): SourceAnalysis {
    const checker = project.configured.checker;
    return createSourceAnalysis({
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

export function typeAnalysis(project: FrozenProject): TypeAnalysis {
    return { compiler: project.compiler.syntax, checker: project.configured.checker };
}

export async function disposeProject(project: FrozenProject): Promise<void> {
    await project.ownership.disposeAsync();
}

export async function verifyFrozenProject(project: FrozenProject, assertionPlan: OriginalAssertionPlan): Promise<void> {
    await verifyInstalledCompiler(project.compiler);
    if (await readFile(project.projectConfigPath, 'utf8') !== project.projectText) {
        throw new Error('Type-test project configuration changed after collection.');
    }
    verifyProjectInputs(project.inputs);
    for (const module of assertionPlan.modules) {
        if (fingerprint(await readFile(module.path, 'utf8')) !== fingerprint(module.originalText)) {
            throw new Error(`Type-test source changed after collection: ${module.path}`);
        }
    }
}
