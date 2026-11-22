import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { suite } from '@overkill-dev/test';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { sealConsumerDependencies } from './support/consumer-resolution-boundary.ts';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

const engineCaseSource = `import * as engine from '@overkill-dev/engine';
import { family, sameType } from '@overkill-dev/type-test';
const metadata = { annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}] } as const;
export const testNode = engine.createTestCase({...metadata, title:'native', body(scope) {
    throwIfExecuted();
    scope.assert(sameType<string,string>());
    return scope.assert.collect();
}});
function throwIfExecuted():void { throw new Error('Static bodies must not execute.'); }`;
const consumerSource = `${engineCaseSource}
const root=engine.createRoot({...metadata,title:'root',children:[testNode]});
const signal = new AbortController().signal;
await using prepared=await engine.prepareFamily({testPlan:engine.createTestPlan(root),testFamily:family,
    settings:{projectConfigPath:'./tsconfig.json',
        compiler:{kind:'package',specifier:'typescript-beta',version:'7.1.0-beta'}},
    projectRoot:PROJECT_ROOT,signal});
const collected=await prepared.collect({workIds:prepared.testPlan.cases.map(entry=>entry.workId),signal});
const result=await engine.execute(collected,{signal,debug:{mode:'off'},retryPolicy:null,reporters:[],
    execution:{mode:'serial-in-process'},runFacts:{},startedAt:new Date().toISOString()});
if(result.status!=='passed'||result.summary.passed!==1) {
    throw new Error(JSON.stringify({summary:result.summary,errors:result.runnerErrors}));
}

if(result.perTest[0]!.workId.familyVariant?.family !== '@overkill-dev/type-test') {
    throw new Error('Missing compiler identity.');
}

console.log('native check passed');`;

type ScriptOutput = { readonly code: number; readonly stdout: string; readonly stderr: string; };
async function runNode(directory: string, argumentList: readonly string[]): Promise<ScriptOutput> {
    return await new Promise(function execute(resolve, reject) {
        execFile(
            process.execPath,
            [ '--disable-warning=PERM0004', ...Array.from(argumentList) ],
            {
                cwd: directory,
                timeout: 120_000,
                env: {
                    ...consumerEnvironment(directory),
                    TSTYCHE_NPM_REGISTRY: 'http://127.0.0.1:1',
                    TSTYCHE_STORE_PATH: join(directory, 'checker-store'),
                    TS_API_TIMING_DIR: join(directory, 'compiler-timings')
                }
            },
            function completed(error, stdout, stderr) {
                if (error === null) {
                    resolve({ code: 0, stdout, stderr });
                } else if (typeof error.code === 'number') {
                    resolve({ code: error.code, stdout, stderr });
                } else {
                    reject(
                        new Error(`Cannot start packaged type-test consumer: ${error.message}\n${stderr}`, {
                            cause: error
                        })
                    );
                }
            }
        );
    });
}

async function provisionCompiler(directory: string): Promise<void> {
    await cp(join(process.cwd(), 'node_modules/typescript-beta'), join(directory, 'node_modules/typescript-beta'), {
        recursive: true
    });
    await cp(join(process.cwd(), 'node_modules/@typescript'), join(directory, 'node_modules/@typescript'), {
        recursive: true
    });
}

async function writeCheckingProject(directory: string): Promise<void> {
    await writeFile(
        join(directory, 'case.mts'),
        consumerSource.replace('PROJECT_ROOT', function projectRoot() {
            return JSON.stringify(directory);
        })
    );
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: { module: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: true, types: [] },
            files: [ 'case.mts' ]
        })
    );
}

async function writeRunnerProject(directory: string, processModel: 'in-process' | 'supervised-process'): Promise<void> {
    await writeFile(
        join(directory, 'runner.mts'),
        `${engineCaseSource}
import {runIfMain} from '@overkill-dev/run';
await runIfMain(import.meta,testNode);`
    );
    await writeFile(
        join(directory, 'overkill.config.js'),
        `import {defineConfig} from '@overkill-dev/run/config';
import {family} from '@overkill-dev/type-test';
import {fileURLToPath} from 'node:url';
export const config=defineConfig({profiles:{types:{testFamily:family,
    execution:{processModel:'${processModel}',scheduling:'serial',maxConcurrency:1},
    files:{include:['runner.mts']},settings:{
    projectConfigPath:fileURLToPath(new URL('./tsconfig.json',import.meta.url)),
    compiler:{kind:'package',specifier:'typescript-beta',version:'7.1.0-beta'}}}}});`
    );
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: { module: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: true, types: [] },
            files: [ 'runner.mts' ]
        })
    );
}

async function wedgeCompilerOnExecution(directory: string): Promise<void> {
    const runner = join(directory, 'runner.mts');
    const config = join(directory, 'overkill.config.js');
    await writeFile(runner, `await import('./wedge-compiler.mjs' + '');\n${await readFile(runner, 'utf8')}`);
    const configText = await readFile(config, 'utf8');
    await writeFile(
        config,
        configText.replace(
            'testFamily:family,',
            'testFamily:family,timeouts:{collectionMilliseconds:30000,softMilliseconds:8000,hardMilliseconds:8000},'
        )
    );
    await writeFile(
        join(directory, 'wedge-compiler.mjs'),
        `
import { channel } from 'node:diagnostics_channel';
import { writeFileSync } from 'node:fs';
let compilers = 0;
channel('child_process').subscribe(({process: child}) => {
    child.once('spawn', () => {
        if (!child.spawnargs.includes('--api') || ++compilers !== 2) return;
        writeFileSync('wedged-processes.json', JSON.stringify([process.pid, child.pid]));
        child.kill('SIGSTOP');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    });
});`
    );
}

async function waitForProcessExit(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            process.kill(pid, 0);
        } catch (error: unknown) {
            if (error instanceof Error && Reflect.get(error, 'code') === 'ESRCH') {
                return;
            }
            throw error;
        }
        await delay(20);
    }
    throw new Error(`Owned process ${pid} still exists after shutdown.`);
}

async function waitForCompilerShutdown(directory: string): Promise<void> {
    const identities: unknown = JSON.parse(await readFile(join(directory, 'wedged-processes.json'), 'utf8'));
    if (!Array.isArray(identities) || identities.length !== 2) {
        throw new TypeError('Expected the analysis host and native compiler PIDs.');
    }
    const ownedProcesses = identities.map(function validatePid(pid: unknown) {
        if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1) {
            throw new TypeError('Expected a process PID.');
        }
        return pid;
    });
    await Promise.all(ownedProcesses.map(waitForProcessExit));
}

const consumerFacade = packageConsumer('packaged native type tests', function consumerFixture(consumerDirectory) {
    async function isolatedConsumer(includeRunner: boolean): Promise<string> {
        const directory = await mkdtemp(join(consumerDirectory, 'overkill-type-test-consumer-'));

        const destination = join(directory, 'node_modules/@overkill-dev');
        await mkdir(destination, { recursive: true });
        const packages = includeRunner ? [ 'engine', 'run', 'type-test' ] : [ 'engine', 'type-test' ];
        for (const name of packages) {
            await cp(join(consumerDirectory, 'node_modules/@overkill-dev', name), join(destination, name), {
                recursive: true
            });
        }
        await provisionCompiler(directory);
        await sealConsumerDependencies(directory);
        await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
        return directory;
    }
    return { isolatedConsumer };
});
const { table, test } = consumerFacade;

export const testNode = suite('packaged native type tests', [
    test('checks engine roots without the high-level distribution', async function (scope) {
        const { isolatedConsumer } = scope.resources.consumer;

        const directory = await isolatedConsumer(false);
        await writeCheckingProject(directory);
        const result = await runNode(directory, [ 'case.mts' ]);
        scope.assert.equal(result.code, 0, { message: result.stderr });
        scope.assert.equal(result.stdout, 'native check passed\n');
        await scope.assert.rejects(async function () {
            return readdir(join(directory, 'compiler-timings'));
        }, { message: /ENOENT/u });
        return scope.assert.collect();
    }),
    test(
        'runs a registered profile through the public runner without the high-level distribution',
        async function (scope) {
            const { isolatedConsumer } = scope.resources.consumer;

            const directory = await isolatedConsumer(true);
            await writeRunnerProject(directory, 'in-process');
            const result = await runNode(directory, [ 'runner.mts' ]);
            scope.assert.equal(result.code, 0, { message: result.stderr });
            scope.assert.includes(result.stdout, '1 pass');
            return scope.assert.collect();
        }
    ),
    test('checks only the runner selection in source order', async function (scope) {
        const { isolatedConsumer } = scope.resources.consumer;
        const directory = await isolatedConsumer(true);
        await writeRunnerProject(directory, 'in-process');
        await writeFile(
            join(directory, 'runner.mts'),
            `import * as engine from '@overkill-dev/engine';
import {sameType} from '@overkill-dev/type-test';
const metadata={annotations:{},controls:{},definitionLocations:[{kind:'unknown'}]} as const;
function passing(title:string) {
    return engine.createTestCase({...metadata,title,body(scope){
        scope.assert(sameType<string,string>());return scope.assert.collect();
    }});
}
const excluded=engine.createTestCase({...metadata,title:'excluded',body(scope){
    scope.assert(sameType<string,number>());return scope.assert.collect();
}});
export const testNode=engine.createSuite({...metadata,title:'root',
    children:[passing('selected z'),excluded,passing('selected a')]});`
        );
        const request = defaultRunRequest({
            order: 'lexical',
            profile: 'types',
            selection: { kind: 'filter', filter: { kind: 'contains', field: 'title', value: 'selected' } }
        });
        const program = `import {commandLineRunner} from '@overkill-dev/run/command-line';
const reply=await commandLineRunner.runTests({cwd:process.cwd(),configPath:null,
    runRequest:${inspect(request, { depth: null })}});
if(reply.exitCode!==0)throw new Error(reply.fallbackDiagnostics.join('\\n'));
console.log(JSON.stringify(reply.runResult?.perTest.map(entry=>entry.id.title)));`;
        const result = await runNode(directory, [ '--input-type=module', '--eval', program ]);
        scope.assert.equal(result.code, 0, { message: result.stderr });
        scope.assert.includes(result.stdout, '["selected z","selected a"]');
        return scope.assert.collect();
    }),
    test('checks installed beta compilers in a supervised profile', async function (scope) {
        const { isolatedConsumer } = scope.resources.consumer;

        const directory = await isolatedConsumer(true);
        await writeRunnerProject(directory, 'supervised-process');
        const result = await runNode(directory, [ 'runner.mts' ]);
        scope.assert.equal(result.code, 0, { message: result.stderr });
        scope.assert.includes(result.stdout, '1 pass');
        return scope.assert.collect();
    }),
    table({
        title: 'reproduces recorded compiler work',
        cases: [ 'in-process', 'supervised-process' ] as const,
        caseTitle: String,
        async test(scope) {
            const { isolatedConsumer } = scope.resources.consumer;
            const directory = await isolatedConsumer(true);
            await writeRunnerProject(directory, scope.parameters);
            const request = defaultRunRequest({
                profile: 'types',
                record: true,
                selection: { kind: 'filter', filter: { kind: 'equals', field: 'title', value: 'native' } }
            });
            const program = `import {commandLineRunner} from '@overkill-dev/run/command-line';
import {readdir,readFile,writeFile} from 'node:fs/promises';
const cwd=process.cwd();
const source=await readFile('runner.mts','utf8');
await writeFile('runner.mts',source.replace('sameType<string,string>()','sameType<string,number>()'));
const original=await commandLineRunner.runTests({cwd,configPath:null,
    runRequest:${inspect(request, { depth: null })}});
if(original.exitCode!==1||original.runResult?.summary.failed!==1) {
    throw new Error(original.fallbackDiagnostics.join('\\n'));
}
const runs='.overkill/runs';
const [file]=await readdir(runs);
const record=JSON.parse(await readFile(runs+'/'+file,'utf8'));
const facts=record.facts.family;
const compiler=facts.preparation.compilers[0];
if(facts.version!=='2'||compiler.version!=='7.1.0-beta'||!compiler.projectFingerprint||
    !compiler.configuration.files.length||facts.collection.compilers[0].assertions.length!==1) {
    throw new Error('Missing original compiler evidence');
}
if(record.result.perTest[0].verdict!=='fail'||record.result.perTest[0].outcome.kind!=='fail') {
    throw new Error('Missing recorded relation failure');
}
const replay=()=>commandLineRunner.replayRun({cwd,configPath:null,arguments:[record.id]});
const reproduced=await replay();
if(reproduced.exitCode!==1||reproduced.runResult?.summary.failed!==1) {
    throw new Error(JSON.stringify(reproduced.fallbackDiagnostics));
}
const config=JSON.parse(await readFile('tsconfig.json','utf8'));
config.compilerOptions.strict=false;
await writeFile('tsconfig.json',JSON.stringify(config));
const drifted=await replay();
if(drifted.exitCode===0||drifted.runResult?.perTest.length)throw new Error('Admitted drifted source');
console.log('reproduced and rejected drift');`;
            const result = await runNode(directory, [ '--input-type=module', '--eval', program ]);
            scope.assert.equal(result.code, 0, { message: result.stdout + result.stderr });
            scope.assert.includes(result.stdout, 'reproduced and rejected drift');
            return scope.assert.collect();
        }
    }),
    test('hard timeout reaps a wedged analysis host and its native compiler', async function (scope) {
        const { isolatedConsumer } = scope.resources.consumer;
        const directory = await isolatedConsumer(true);
        await writeRunnerProject(directory, 'supervised-process');
        await wedgeCompilerOnExecution(directory);
        const result = await runNode(directory, [ 'runner.mts' ]);
        scope.assert.equal(result.code, 1, { message: result.stderr });
        scope.assert.true(/hard timeout/iu.test(result.stdout + result.stderr), {
            message: result.stdout + result.stderr
        });
        scope.assert.includes(result.stdout, 'inconclusive');
        await waitForCompilerShutdown(directory);
        return scope.assert.collect();
    }),
    test('authoring and profile imports do not load the execution backend', async function (scope) {
        const { isolatedConsumer } = scope.resources.consumer;

        const directory = await isolatedConsumer(false);
        const backend = join(
            directory,
            'node_modules/@overkill-dev/type-test/packages/type-test/family-backend.entry-point.js'
        );
        await readFile(backend);
        await rm(backend);
        const script = `import {family,sameType,assignableTo,assignableFrom} from '@overkill-dev/type-test';
sameType();assignableTo();assignableFrom();
if(family.id!=='@overkill-dev/type-test')throw new Error('Missing family');
for(const subpath of ['profile','check']) {
    try { await import('@overkill-dev/type-test/'+subpath); throw new Error('Unexpected public subpath'); }
    catch(error) { if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }
}

console.log('lazy imports passed');`;
        const result = await runNode(directory, [ '--input-type=module', '--eval', script ]);
        scope.assert.equal(result.code, 0, { message: result.stderr });
        scope.assert.equal(result.stdout, 'lazy imports passed\n');
        return scope.assert.collect();
    })
]);
