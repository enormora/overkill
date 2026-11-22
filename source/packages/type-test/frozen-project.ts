import { setTimeout as yieldToTimers } from 'node:timers/promises';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { API, Snapshot, Project, ParsedCommandLine } from 'typescript-beta/async';
import {
    closeCompilerConnection,
    createCompilerLifetime,
    runCompilerOperation
} from './compiler-lifetime.ts';
import { openCompiler } from './compiler-process.entry-point.ts';
import type { CompilerSelection } from './profile-settings.ts';
import { resolveInstalledCompiler, verifyInstalledCompiler, type InstalledCompiler } from './installed-compiler.ts';
import {
    observeProjectInputs,
    verifyProjectInputs,
    sourceFingerprint,
    type FrozenInputs,
    type ProjectInputObservation
} from './frozen-inputs.ts';
import type { TypeAnalysis } from './source-analysis-port.ts';

type CapturedProject = {
    readonly compiler: InstalledCompiler;
    readonly api: API;
    readonly snapshot: Snapshot;
    readonly configured: Project;
    readonly projectConfigPath: string;
    readonly project: ParsedCommandLine;
    readonly program: Project['program'];
    readonly inputs: FrozenInputs;
    readonly observation: ProjectInputObservation;
    readonly projectText: string;
};

export type FrozenProject = CapturedProject & {
    readonly execute: <Value>(signal: AbortSignal, operation: () => Promise<Value>) => Promise<Value>;
    readonly ownership: AsyncDisposableStack;
};
type ProjectSession = {
    readonly compiler: InstalledCompiler;
    readonly api: API;
    readonly projectConfigPath: string;
    readonly observation: ProjectInputObservation;
    readonly signal: AbortSignal;
};
export async function checkCompilerCancellation(signal: AbortSignal): Promise<void> {
    await yieldToTimers(0);
    signal.throwIfAborted();
}
export const fingerprint = sourceFingerprint;
function configuredProject(snapshot: Snapshot, path: string): Project {
    const project = snapshot.getConfiguredProject(path);
    if (project === undefined) {
        throw new Error('Original configured project is unavailable.');
    }
    return project;
}

async function parseProject(input: ProjectSession): Promise<ParsedCommandLine> {
    const project = await input.api.parseConfigFile(input.projectConfigPath);
    if (project.errors.length > 0) {
        throw new Error(`Cannot parse original project: ${input.projectConfigPath}`, { cause: project.errors });
    }
    input.signal.throwIfAborted();
    return project;
}

async function captureProject(
    input: ProjectSession
): Promise<CapturedProject> {
    const project = await parseProject(input);
    const snapshot = await input.api.createSnapshot({ openProjects: [ input.projectConfigPath ] });
    input.signal.throwIfAborted();
    const configured = configuredProject(snapshot, input.projectConfigPath);
    const paths = await configured.program.getSourceFileNames();
    input.signal.throwIfAborted();
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
        observation: input.observation,
        inputs: input.observation.snapshot(),
        projectText: await readFile(input.projectConfigPath, 'utf8')
    };
}

export async function loadProject(
    projectPath: string,
    selection: CompilerSelection,
    projectRoot: string,
    signal: AbortSignal
): Promise<FrozenProject> {
    signal.throwIfAborted();
    const compiler = await resolveInstalledCompiler(projectRoot, selection, signal);
    await using ownership = new AsyncDisposableStack();
    const observation = observeProjectInputs();
    const lifetime = ownership.use(createCompilerLifetime());
    const api = openCompiler(compiler, projectRoot, observation);
    ownership.defer(async function releaseCompiler() {
        await closeCompilerConnection(lifetime, api.close.bind(api));
    });
    const project = await runCompilerOperation(lifetime, signal, async function capture() {
        return await captureProject({
            compiler,
            api,
            observation,
            signal,
            projectConfigPath: resolve(projectRoot, projectPath)
        });
    });
    verifyProjectInputs(project.inputs, signal);
    return {
        ...project,
        ownership: ownership.move(),
        async execute(operationSignal, operation) {
            return await runCompilerOperation(lifetime, operationSignal, operation);
        }
    };
}

export function typeAnalysis(project: FrozenProject): TypeAnalysis {
    return { compiler: project.compiler.syntax, checker: project.configured.checker };
}

export async function disposeProject(project: FrozenProject): Promise<void> {
    await project.ownership.disposeAsync();
}

type AssertionSourceInput = { readonly path: string; readonly originalText: string; };

export async function verifyFrozenProject(
    project: FrozenProject,
    modules: readonly AssertionSourceInput[],
    signal: AbortSignal
): Promise<void> {
    signal.throwIfAborted();
    await verifyInstalledCompiler(project.compiler, signal);
    if (await readFile(project.projectConfigPath, 'utf8') !== project.projectText) {
        throw new Error('Type-test project configuration changed after collection.');
    }
    verifyProjectInputs(project.observation.snapshot(), signal);
    for (const module of modules) {
        signal.throwIfAborted();
        if (fingerprint(await readFile(module.path, 'utf8')) !== fingerprint(module.originalText)) {
            throw new Error(`Type-test source changed after collection: ${module.path}`);
        }
    }
}
