import { consumerEnvironment } from './support/consumer-environment.ts';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';

import { join } from 'node:path';
import { suite } from '@overkill-dev/test';
import { packageConsumer } from './support/package-consumer.ts';

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
        await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
        return directory;
    }
    return { isolatedConsumer };
});
const { test } = consumerFacade;

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
            Array.from(argumentList),
            {
                cwd: directory,
                env: consumerEnvironment({
                    TSTYCHE_NPM_REGISTRY: 'http://127.0.0.1:1',
                    TSTYCHE_STORE_PATH: join(directory, 'checker-store')
                }, directory)
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

export const testNode = suite('packaged native type tests', [
    test('checks engine roots without the high-level distribution', async function (scope) {
        const { isolatedConsumer } = scope.resources.consumer;

        const directory = await isolatedConsumer(false);
        await writeCheckingProject(directory);
        const result = await runNode(directory, [ 'case.mts' ]);
        scope.assert.equal(result.code, 0, { message: result.stderr });
        scope.assert.equal(result.stdout, 'native check passed\n');
        await scope.assert.rejects(async function () {
            return readdir(join(directory, 'checker-store'));
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
    test('checks installed beta compilers in a supervised profile', async function (scope) {
        const { isolatedConsumer } = scope.resources.consumer;

        const directory = await isolatedConsumer(true);
        await writeRunnerProject(directory, 'supervised-process');
        const result = await runNode(directory, [ 'runner.mts' ]);
        scope.assert.equal(result.code, 0, { message: result.stderr });
        scope.assert.includes(result.stdout, '1 pass');
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
