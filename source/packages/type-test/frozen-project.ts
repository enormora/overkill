import { setTimeout as yieldToTimers } from 'node:timers/promises';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { API, Project, ParsedCommandLine } from 'typescript-beta/async';
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

export { frozenInputFacts } from './frozen-inputs.ts';

type CapturedProject = {
    readonly compiler: InstalledCompiler;
    readonly checker: Project['checker'];
    readonly projectConfigPath: string;
    readonly project: ParsedCommandLine;
    readonly program: Project['program'];
    readonly diagnosticProgram: () => Promise<Project['program']>;
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
async function openConfiguredProject(input: ProjectSession): Promise<Project> {
    const snapshot = await input.api.createSnapshot({ openProjects: [ input.projectConfigPath ] });
    const project = snapshot.getConfiguredProject(input.projectConfigPath);
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

async function openAnalysisProject(
    input: ProjectSession,
    parsed: ParsedCommandLine
): Promise<Pick<CapturedProject, 'checker' | 'diagnosticProgram' | 'program'>> {
    const standalone = (parsed.projectReferences?.length ?? 0) === 0 && parsed.typeAcquisition?.enable !== true;
    if (standalone) {
        const program = await input.api.createProgram(parsed.fileNames, parsed.options);
        return {
            program,
            checker: program.getProject().checker,
            async diagnosticProgram() {
                const configured = await openConfiguredProject(input);
                return configured.program;
            }
        };
    }
    const { program, checker } = await openConfiguredProject(input);
    return {
        program,
        checker,
        async diagnosticProgram() {
            return program;
        }
    };
}

async function captureProject(input: ProjectSession): Promise<CapturedProject> {
    const project = await parseProject(input);
    const analysis = await openAnalysisProject(input, project);
    input.signal.throwIfAborted();
    const paths = await analysis.program.getSourceFileNames();
    input.signal.throwIfAborted();
    for (const path of paths) {
        input.observation.fs.realpath(path);
    }
    return {
        compiler: input.compiler,
        ...analysis,
        projectConfigPath: input.projectConfigPath,
        project,
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

export function originalProjectFacts(project: FrozenProject): unknown {
    const configuration = JSON.stringify({
        options: project.project.options,
        files: project.project.fileNames,
        references: project.project.projectReferences ?? []
    });
    return JSON.parse(configuration);
}

export function typeAnalysis(project: FrozenProject): TypeAnalysis {
    return { program: project.program, compiler: project.compiler.syntax, checker: project.checker };
}

export async function disposeProject(project: FrozenProject): Promise<void> {
    await project.ownership.disposeAsync();
}

type AssertionSourceInput = { readonly path: string; readonly originalText: string; };

async function verifyProjectSources(
    project: FrozenProject,
    modules: readonly AssertionSourceInput[],
    signal: AbortSignal
): Promise<void> {
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

export async function verifyFrozenProject(
    project: FrozenProject,
    modules: readonly AssertionSourceInput[],
    signal: AbortSignal
): Promise<void> {
    signal.throwIfAborted();
    const results = await Promise.allSettled([
        verifyInstalledCompiler(project.compiler, signal),
        verifyProjectSources(project, modules, signal)
    ]);
    for (const result of results) {
        if (result.status === 'rejected') {
            throw result.reason;
        }
    }
}
