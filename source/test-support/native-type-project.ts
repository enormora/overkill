import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import TypeScript from 'typescript';
import { z } from 'zod';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';

const resultSchema = z
    .object({
        status: z.enum([ 'passed', 'failed' ]),
        summary: z.object({ passed: z.number(), failed: z.number(), skipped: z.number(), inconclusive: z.number() }),
        titles: z.array(z.string()),
        errors: z.array(z.string()),
        bodyCalls: z.number(),
        compilerVersions: z.array(z.string()),
        artifactCount: z.number(),
        diagnostics: z.array(z.string())
    })
    .readonly();
export type NativeProjectResult = z.infer<typeof resultSchema>;
type ProjectChange = 'config' | 'identity' | 'source';
type ProjectRequest = {
    readonly definitions: string;
    readonly titles: readonly string[] | null;
    readonly compiled: boolean;
    readonly change: ProjectChange | null;
};

function executionSource(request: ProjectRequest, selection: string): string {
    if (request.change === null) {
        return `const result = await checkTypeTests({engine, root, selection: ${selection},
    projectConfigPath: import.meta.dirname + '/tsconfig.json', compiler: { kind: 'local' }});`;
    }
    const packages = resolvePath(import.meta.dirname, '../packages');
    const runPath = JSON.stringify(join(packages, 'run/run.entry-point.ts'));
    const path = request.change === 'source' ? 'import.meta.filename' : "import.meta.dirname+'/tsconfig.json'";
    const change = request.change === 'identity'
        ? `plan={...plan,cases:[{...plan.cases[0],workId:{...plan.cases[0].workId,
    compiler:{name:'typescript',version:'0.0.0'}}},...plan.cases.slice(1)]};`
        : `await appendFile(${path},'\\n');`;
    return `const {prepareAdapterPlan,executeAdapterPlan}=await import(${runPath});
const settings={projectConfigPath:import.meta.dirname+'/tsconfig.json',compiler:{kind:'local'}};
let plan=await prepareAdapterPlan(typeTestAdapter,settings,engine.createTestPlan(root));
const {appendFile}=await import('node:fs/promises');
${change}
const result=await executeAdapterPlan(typeTestAdapter,settings,plan);`;
}

function fixtureSource(request: ProjectRequest): string {
    const packages = resolvePath(import.meta.dirname, '../packages');
    const engineImport = JSON.stringify(join(packages, 'engine/engine.entry-point.ts'));
    const authoringImport = JSON.stringify(join(packages, 'test/test.entry-point.ts'));
    const assertionImport = JSON.stringify(join(packages, 'type-test/type-test.entry-point.ts'));
    const checkerImport = JSON.stringify(join(packages, 'type-test/check.entry-point.ts'));
    const resourceImport = JSON.stringify(join(packages, 'test/resources.entry-point.ts'));
    const profileImport = JSON.stringify(join(packages, 'type-test/profile.entry-point.ts'));
    const selection = request.titles === null ? { kind: 'all' } : {
        kind: 'filter',
        filter: {
            kind: 'any',
            filters: request.titles.map(function title(value) {
                return { kind: 'equals', field: 'title', value };
            })
        }
    };
    return `import * as engine from ${engineImport};
import { test, suite, table, defineMacro, defineParameterizedTestBody } from ${authoringImport};
import {
    sameType as same, assignableTo, assignableFrom, acceptsProps, applicableTo,
    callableWith, constructableWith, instantiableWith, hasProperty, raisesTypeError, type _
} from ${assertionImport};
import { checkTypeTests } from ${checkerImport};
import { defineResource, withResource } from ${resourceImport};
import { typeTestAdapter } from ${profileImport};
const metadata = { annotations: {}, controls: {}, definitionLocations: [{ kind: 'unknown' }] } as const;
let bodyCalls = 0;
${request.definitions}
const root = engine.createRoot({ title: 'native', annotations: {}, controls: {}, children: nodes });
${executionSource(request, JSON.stringify(selection))}
console.log(JSON.stringify({
    status: result.status, summary: result.summary, titles: result.perTest.map(r => r.id.title),
    errors: result.runnerErrors.map(r => r.message), bodyCalls,
    compilerVersions: result.perTest.map(r =>
        engine.isCompilerWorkId(r.workId) ? r.workId.compiler.version : 'missing'),
    artifactCount: result.artifacts.length,
    diagnostics: result.perTest.flatMap(r => r.outcome?.kind === 'fail'
        ? r.outcome.failures.flatMap(f => f.kind === 'assertion' ? f.checks.map(c => c.summary) : [f.kind]) : [])
}));`;
}

async function executeProject(path: string): Promise<string> {
    return new Promise(function execute(resolve, reject) {
        execFile(
            process.execPath,
            [ '--enable-source-maps', path ],
            { timeout: 90_000 },
            function completed(error, stdout, stderr) {
                if (error !== null) {
                    reject(new Error(stderr, { cause: error }));
                    return;
                }
                resolve(stdout);
            }
        );
    });
}

async function writeCompiledProject(directory: string, sourceName: string, source: string): Promise<string> {
    const emitted = TypeScript.transpileModule(source, {
        fileName: sourceName,
        compilerOptions: {
            target: TypeScript.ScriptTarget.ES2022,
            module: TypeScript.ModuleKind.ESNext,
            sourceMap: true,
            inlineSources: true
        }
    });
    const script = emitted.outputText.replace(/sourceMappingURL=.*/u, 'sourceMappingURL=cases.js.map');
    await writeFile(join(directory, 'cases.js'), script);
    await writeFile(join(directory, 'cases.js.map'), emitted.sourceMapText ?? '');
    return join(directory, 'cases.js');
}

async function writeProject(directory: string, request: ProjectRequest): Promise<string> {
    const sourceName = request.compiled ? 'cases.tsx' : 'cases.ts';
    const config = {
        compilerOptions: {
            target: 'ESNext',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            jsx: 'preserve',
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            allowImportingTsExtensions: true,
            types: [ 'node' ]
        },
        files: [ sourceName ]
    };
    const source = fixtureSource(request);
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify(config));
    await writeFile(join(directory, sourceName), source);
    if (!request.compiled) {
        return join(directory, sourceName);
    }
    return await writeCompiledProject(directory, sourceName, source);
}

async function runProject(scope: TestScope, request: ProjectRequest): Promise<NativeProjectResult> {
    await mkdir(join(process.cwd(), 'target'), { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), 'target/native-type-'));
    scope.cleanup(async function removeProject() {
        await rm(directory, { recursive: true, force: true });
    });
    const path = await writeProject(directory, request);
    return resultSchema.parse(JSON.parse(await executeProject(path)));
}

export async function runNativeProject(
    scope: TestScope,
    definitions: string,
    titles: readonly string[] | null
): Promise<NativeProjectResult> {
    return await runProject(scope, { definitions, titles, compiled: false, change: null });
}

export async function runCompiledTypeProject(
    scope: TestScope,
    definitions: string,
    titles: readonly string[] | null
): Promise<NativeProjectResult> {
    return await runProject(scope, { definitions, titles, compiled: true, change: null });
}

export async function runChangedTypeProject(
    scope: TestScope,
    definitions: string,
    change: ProjectChange
): Promise<NativeProjectResult> {
    return await runProject(scope, { definitions, titles: null, compiled: false, change });
}
