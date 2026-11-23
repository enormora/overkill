import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, chmod } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import TypeScript from 'typescript';
import { z } from 'zod';
import type { TestScope } from '@overkill-dev/test';
import type { TypeTestSettings } from '../packages/type-test/profile-settings.ts';

const readOnlyProjectMode = 0o555;
const writableProjectMode = 0o755;

const checkerFactsVersion = 3;
const resultSchema = z
    .object({
        status: z.enum([ 'passed', 'failed' ]),
        summary: z.object({ passed: z.number(), failed: z.number(), skipped: z.number(), inconclusive: z.number() }),
        titles: z.array(z.string()),
        errors: z.array(z.string()),
        bodyCalls: z.number(),
        compilerVersions: z.array(z.string()),
        artifactCount: z.number(),
        logicalCaseCount: z.number(),
        diagnostics: z.array(z.string()),
        durations: z.array(z.number()),
        events: z.array(z.string()),
        phase: z.enum([ 'prepare', 'collect', 'execute' ]),
        completions: z.array(z.object({ title: z.string(), verdict: z.string() })),
        checkerFacts: z
            .object({
                version: z.literal(checkerFactsVersion),
                identities: z.array(z.object({ case: z.object({ title: z.string() }) })),
                compilers: z.array(z.object({
                    issues: z.array(z.object({ reason: z.string(), location: z.object({ kind: z.string() }) })),
                    evidence: z
                        .array(z.object({
                            path: z.string(),
                            line: z.number(),
                            column: z.number(),
                            owners: z.array(z.object({ case: z.object({ title: z.string() }) }))
                        }))
                        .optional()
                }))
            })
            .nullable()
    })
    .readonly();
export type NativeProjectResult = z.infer<typeof resultSchema>;
type ProjectChange = 'config' | 'identity' | 'source';
type ProjectRequest = {
    readonly compiler: TypeTestSettings['compiler'];
    readonly prefix: string;
    readonly definitions: string;
    readonly titles: readonly string[] | null;
    readonly compiled: boolean;
    readonly change: ProjectChange | null;
};

function executionSource(request: ProjectRequest): string {
    if (request.change === null) {
        const caseSelection = request.titles === null
            ? 'prepared.testPlan.cases.map(c=>c.workId)'
            : `${JSON.stringify(request.titles)}.flatMap(title=>prepared.testPlan.cases
                .filter(c=>c.id.title===title).map(c=>c.workId))`;
        return `let result;
try {
const signal = new AbortController().signal;
await using prepared = await engine.prepareFamily({testPlan:engine.createTestPlan(root),testFamily:family,
    settings:{projectConfigPath:import.meta.dirname+'/tsconfig.json',compiler:${JSON.stringify(request.compiler)}},
    projectRoot:import.meta.dirname,signal});
const workIds=${caseSelection};
phase='collect';
const collected=await prepared.collect({workIds,signal});
phase='execute';
result=await engine.execute(collected,{signal,debug:{mode:'off'},retryPolicy:null,reporters:[reporter],
    execution:{mode:'serial-in-process'},runFacts:{},startedAt:new Date().toISOString()});
} catch(error) {
result=engine.createRunResult(engine.createTestPlan(root),[],[{subtype:'loader',cause:error,message:String(error),
    attributedTo:null,attributedToAttempt:null,diagnostics:[]}],{startedAtMicroseconds:0,completedAtMicroseconds:0,
    testExecutionWallTimeMicroseconds:0,processUsage:null,planStatus:'planned'});
}`;
    }
    const path = request.change === 'source' ? 'import.meta.filename' : "import.meta.dirname+'/tsconfig.json'";
    const change = request.change === 'identity'
        ? `plan={...plan,cases:[{...plan.cases[0],workId:{...plan.cases[0].workId,
    familyVariant:{family:'@overkill-dev/type-test',key:'typescript@0.0.0'}}},...plan.cases.slice(1)]};`
        : `await appendFile(${path},'\\n');`;
    return `const settings={projectConfigPath:import.meta.dirname+'/tsconfig.json',
    compiler:{kind:'package',specifier:'typescript-beta',version:'7.1.0-beta'}};
const signal=new AbortController().signal;
await using prepared=await engine.prepareFamily({testPlan:engine.createTestPlan(root),testFamily:family,settings,
    projectRoot:import.meta.dirname,signal});
let plan=prepared.testPlan;
const {appendFile}=await import('node:fs/promises');
${change}
let result;
try {
phase='collect';
const collected=await prepared.collect({workIds:plan.cases.map(c=>c.workId),signal});
phase='execute';
result=await engine.execute(collected,{signal,debug:{mode:'off'},retryPolicy:null,reporters:[],
    execution:{mode:'serial-in-process'},runFacts:{},startedAt:new Date().toISOString()});
} catch(error) {
result=engine.createRunResult(plan,[],[{subtype:'loader',cause:error,message:String(error),attributedTo:null,
    attributedToAttempt:null,diagnostics:[]}],{startedAtMicroseconds:0,completedAtMicroseconds:0,
    testExecutionWallTimeMicroseconds:0,processUsage:null,planStatus:'planned'});
}`;
}

function fixtureSource(request: ProjectRequest): string {
    const packages = resolvePath(import.meta.dirname, '../packages');
    const engineImport = JSON.stringify(join(packages, 'engine/engine.entry-point.ts'));
    const authoringImport = JSON.stringify(join(packages, 'test/test.entry-point.ts'));
    const assertionImport = JSON.stringify(join(packages, 'type-test/type-test.entry-point.ts'));
    const compilerImport = JSON.stringify(join(packages, 'type-test/compiler-plan.ts'));
    const resourceImport = JSON.stringify(join(packages, 'test/resources.entry-point.ts'));
    const profileImport = JSON.stringify(join(packages, 'type-test/profile.entry-point.ts'));
    return `${request.prefix}import * as engine from ${engineImport};
import { test, suite, table, defineMacro, defineParameterizedTestBody } from ${authoringImport};
import {
    sameType as same, assignableTo, assignableFrom
} from ${assertionImport};
import { prepare as prepareCompilerPlan } from ${compilerImport};
import { defineResource, withResource } from ${resourceImport};
import { family } from ${profileImport};
const metadata = { annotations: {}, controls: {}, definitionLocations: [{ kind: 'unknown' }] } as const;
let bodyCalls = 0;
let phase: 'prepare' | 'collect' | 'execute' = 'prepare';
const events: string[] = [];
${request.definitions}
const completions: {title:string;verdict:string}[] = [];
const reporter = engine.defineReporter(() => ({
    kind:'real-time',name:'type-test fixture',sinks:[{kind:'memory'}],onFinish:null,dispose:null,
    onEvent(event) {
        if(event.kind==='test-start'||event.kind==='test-end') events.push(event.kind);
        if(event.kind==='test-end') completions.push({title:event.case.title,verdict:event.verdict});
    }
}));
const root = engine.createRoot({ title: 'native', annotations: {}, controls: {}, children: nodes });
${executionSource(request)}
const checkerArtifact = result.artifacts.find(artifact=>artifact.payload.kind==='adapter'&&
    artifact.payload.adapter==='@overkill-dev/type-test');
const facts = checkerArtifact?.payload.kind==='adapter'
    ? checkerArtifact.payload.facts as {
        version:number;identities:unknown[];compilers:{issues:unknown[];evidence?:unknown[]}[]
    }
    : null;
console.log(JSON.stringify({
    status: result.status, summary: result.summary, titles: result.perTest.map(r => r.id.title),
    errors: result.runnerErrors.map(r => r.message), bodyCalls, events, phase,
    durations: result.perTest.map(r => r.durationMicroseconds),
    compilerVersions: result.perTest.map(r =>
        r.workId.familyVariant?.key.replace('typescript@', '') ?? 'missing'),
    artifactCount: result.artifacts.length,
    completions,
    checkerFacts: facts===null ? null : {
        version:facts.version,identities:facts.identities,
        compilers:facts.compilers.map(({issues,evidence})=>({issues,evidence}))
    },
    logicalCaseCount: new Set(result.perTest.map(r => JSON.stringify(r.id))).size,
    diagnostics: result.perTest.flatMap(r => r.outcome?.kind === 'fail'
        ? r.outcome.failures.flatMap(f => f.kind === 'assertion' ? f.checks.map(c => c.summary) : [f.kind]) : [])
}));`;
}

async function executeProject(path: string): Promise<string> {
    return new Promise(function execute(resolve, reject) {
        execFile(
            process.execPath,
            [ '--disable-warning=PERM0004', '--enable-source-maps', path ],
            { timeout: 90_000 },
            function completed(error, stdout, stderr) {
                if (error !== null) {
                    reject(
                        new Error(
                            `Type-test fixture failed (${error.code ?? error.signal ?? 'unknown exit'}): ${
                                stderr.length === 0 ? error.message : stderr
                            }`,
                            { cause: error }
                        )
                    );
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
            lib: [ 'ESNext' ],
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
    const packages = resolvePath(import.meta.dirname, '../packages');
    await writeFile(
        join(directory, 'dependency.ts'),
        `
import type { TestScope } from ${JSON.stringify(join(packages, 'engine/engine.entry-point.ts'))};
import { sameType } from ${JSON.stringify(join(packages, 'type-test/type-test.entry-point.ts'))};
export type Value = { readonly value: string };
export function importedBody(scope: TestScope) {
    throwIfExecuted();
    scope.assert(sameType<Value, { readonly value: string }>());
    return scope.assert.collect();
}
function throwIfExecuted(): void { throw new Error('Imported static body ran.'); }
`
    );
    if (!request.compiled) {
        return join(directory, sourceName);
    }
    return await writeCompiledProject(directory, sourceName, source);
}

async function runProject(cleanup: TestScope['cleanup'], request: ProjectRequest): Promise<NativeProjectResult> {
    await mkdir(join(process.cwd(), 'target'), { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), 'target/native-type-'));
    cleanup(async function removeProject() {
        await chmod(directory, writableProjectMode);
        await rm(directory, { recursive: true, force: true });
    });
    const path = await writeProject(directory, request);
    if (request.change === null) {
        await chmod(directory, readOnlyProjectMode);
    }
    return resultSchema.parse(JSON.parse(await executeProject(path)));
}

export async function runNativeProject(
    cleanup: TestScope['cleanup'],
    definitions: string,
    titles: readonly string[] | null
): Promise<NativeProjectResult> {
    return await runProject(cleanup, {
        compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' },
        definitions,
        titles,
        compiled: false,
        change: null,
        prefix: ''
    });
}

export async function runCompiledTypeProject(
    cleanup: TestScope['cleanup'],
    definitions: string,
    titles: readonly string[] | null
): Promise<NativeProjectResult> {
    return await runProject(cleanup, {
        compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' },
        definitions,
        titles,
        compiled: true,
        change: null,
        prefix: ''
    });
}

export async function runChangedTypeProject(
    cleanup: TestScope['cleanup'],
    definitions: string,
    change: ProjectChange
): Promise<NativeProjectResult> {
    return await runProject(cleanup, {
        compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' },
        definitions,
        titles: null,
        compiled: false,
        change,
        prefix: ''
    });
}

export async function runPrefixedTypeProject(
    cleanup: TestScope['cleanup'],
    definitions: string,
    prefix: string
): Promise<NativeProjectResult> {
    return await runProject(cleanup, {
        compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' },
        definitions,
        titles: null,
        compiled: false,
        change: null,
        prefix
    });
}

export async function runMatrixTypeProject(
    cleanup: TestScope['cleanup'],
    definitions: string
): Promise<NativeProjectResult> {
    return await runProject(cleanup, {
        definitions,
        titles: null,
        compiled: false,
        change: null,
        prefix: '',
        compiler: {
            kind: 'matrix',
            compilers: [
                { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' },
                { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' },
                { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' }
            ]
        }
    });
}
