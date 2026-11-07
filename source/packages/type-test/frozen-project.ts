import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { Store } from 'tstyche/api';
import { isCompilerWorkId, type TestPlan, type TestBodyOrigin } from '../engine/engine.entry-point.ts';
import { typeTestSettingsSchema } from './profile-settings.ts';
import { parseProject } from './generated-module-plan.ts';
import type { NativeTranslation } from './native-translation.ts';

type Compiler = NonNullable<Awaited<ReturnType<typeof Store.load>>>;
export type FrozenProject = {
    readonly compiler: Compiler;
    readonly projectConfigPath: string;
    readonly projectText: string;
    readonly project: ReturnType<typeof parseProject>;
    readonly program: ReturnType<Compiler['createProgram']>;
};
const caseProjects = new WeakMap<TestPlan['cases'][number], FrozenProject>();
const bodyProjects = new WeakMap<TestBodyOrigin, FrozenProject>();

export function fingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

async function loadProject(settings: unknown): Promise<FrozenProject> {
    const options = typeTestSettingsSchema.parse(settings);
    const target = options.compiler.kind === 'local' ? '*' : options.compiler.version;
    const compiler = await Store.load(target);
    if (compiler === undefined || options.compiler.kind === 'version' && compiler.version !== target) {
        throw new Error('Cannot load the expected exact compiler version.');
    }
    const projectConfigPath = resolve(options.projectConfigPath);
    const project = parseProject({ compiler, projectConfigPath, modules: [] });
    const program = compiler.createProgram({
        rootNames: project.fileNames,
        options: project.options,
        ...project.projectReferences === undefined ? {} : { projectReferences: project.projectReferences }
    });
    return { compiler, projectConfigPath, project, program, projectText: await readFile(projectConfigPath, 'utf8') };
}

export async function prepareNativePlan(plan: TestPlan, settings: unknown): Promise<TestPlan> {
    const project = await loadProject(settings);
    function variant(testCase: TestPlan['cases'][number]): TestPlan['cases'][number] {
        const result = {
            ...testCase,
            workId: {
                ...testCase.workId,
                compiler: { name: 'typescript' as const, version: project.compiler.version }
            }
        };
        caseProjects.set(result, project);
        if (testCase.bodyOrigin !== null) {
            bodyProjects.set(testCase.bodyOrigin, project);
        }
        return result;
    }
    return {
        ...plan,
        cases: [ variant(plan.cases[0]), ...plan.cases.slice(1).map(variant) ],
        discoveredCases: [ variant(plan.discoveredCases[0]), ...plan.discoveredCases.slice(1).map(variant) ]
    };
}

export function frozenProject(plan: TestPlan): FrozenProject {
    const first = plan.cases[0];
    const project = caseProjects.get(first) ??
        (first.bodyOrigin === null ? undefined : bodyProjects.get(first.bodyOrigin));
    if (project === undefined) {
        throw new Error('Type-test plan has no frozen compiler inputs.');
    }
    if (
        plan.cases.some(function mismatchedCompiler(testCase) {
            return !isCompilerWorkId(testCase.workId) || testCase.workId.compiler.version !== project.compiler.version;
        })
    ) {
        throw new Error('Compiler work identity does not match the frozen project.');
    }
    return project;
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
    for (const module of translation.modules) {
        if (fingerprint(await readFile(module.path, 'utf8')) !== fingerprint(module.originalText)) {
            throw new Error(`Type-test source changed after collection: ${module.path}`);
        }
    }
}
