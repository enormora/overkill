import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuite, createTestCase, type TestScope } from '@overkill-dev/engine';
import { runIfMain } from '#test-runner';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const engineCaseSource = `import * as engine from '@overkill-dev/engine';
import { sameType } from '@overkill-dev/type-test';
const metadata = { annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}] } as const;
const node = engine.createTestCase({...metadata, title:'native', body(scope) {
    throwIfExecuted();
    scope.assert(sameType<string,string>());
    return scope.assert.collect();
}});
function throwIfExecuted():void { throw new Error('Static bodies must not execute.'); }`;
const consumerSource = `${engineCaseSource}
import { checkTypeTests } from '@overkill-dev/type-test/check';
const root=engine.createRoot({...metadata,title:'root',children:[node]});
const result=await checkTypeTests({order:'plan',seed:{value:null},shard:{index:1,total:1},
engine,root,selection:{kind:'all'},
    projectConfigPath:new URL('./tsconfig.json',import.meta.url).pathname,compiler:{kind:'local'}});
if(result.status!=='passed'||result.summary.passed!==1) { throw new Error(JSON.stringify(result)); }
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
            { cwd: directory },
            function completed(error, stdout, stderr) {
                if (error === null) {
                    resolve({ code: 0, stdout, stderr });
                } else if (typeof error.code === 'number') {
                    resolve({ code: error.code, stdout, stderr });
                } else {
                    reject(new Error('Cannot start packaged type-test consumer.', { cause: error }));
                }
            }
        );
    });
}

async function isolatedConsumer(scope: TestScope): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-type-test-consumer-'));
    scope.cleanup(async function removeConsumer() {
        await rm(directory, { recursive: true, force: true });
    });
    const destination = join(directory, 'node_modules/@overkill-dev');
    await mkdir(destination, { recursive: true });
    for (const name of [ 'engine', 'run', 'type-test' ]) {
        await cp(join(import.meta.dirname, 'node_modules/@overkill-dev', name), join(destination, name), {
            recursive: true
        });
    }
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    return directory;
}

async function writeCheckingProject(directory: string): Promise<void> {
    await writeFile(join(directory, 'case.mts'), consumerSource);
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: { module: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: true, types: [] },
            files: [ 'case.mts' ]
        })
    );
}

async function writeRunnerProject(directory: string): Promise<void> {
    await writeFile(
        join(directory, 'runner.mts'),
        `${engineCaseSource}
import {runIfMain} from '@overkill-dev/run';
await runIfMain(import.meta,node);`
    );
    await writeFile(
        join(directory, 'overkill.config.js'),
        `import {defineConfig} from '@overkill-dev/run/config';
import {typeTestProfile} from '@overkill-dev/type-test/profile';
import {fileURLToPath} from 'node:url';
export const config=defineConfig({profiles:{types:typeTestProfile({files:{include:['runner.mts']},
    projectConfigPath:fileURLToPath(new URL('./tsconfig.json',import.meta.url)),compiler:{kind:'local'}})}});`
    );
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: { module: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: true, types: [] },
            files: [ 'runner.mts' ]
        })
    );
}

export const testNode = createSuite({
    ...metadata,
    title: 'packaged native type tests',
    children: [
        createTestCase({
            ...metadata,
            title: 'checks engine roots without the high-level distribution',
            async body(scope) {
                const directory = await isolatedConsumer(scope);
                await writeCheckingProject(directory);
                const result = await runNode(directory, [ 'case.mts' ]);
                scope.assert.equal(result.code, 0, { message: result.stderr });
                scope.assert.equal(result.stdout, 'native check passed\n');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'runs a registered profile through the public runner without the high-level distribution',
            async body(scope) {
                const directory = await isolatedConsumer(scope);
                await writeRunnerProject(directory);
                const result = await runNode(directory, [ 'runner.mts' ]);
                scope.assert.equal(result.code, 0, { message: result.stderr });
                scope.assert.includes(result.stdout, '1 pass');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'authoring and profile imports do not load the execution backend',
            async body(scope) {
                const directory = await isolatedConsumer(scope);
                const backend = join(
                    directory,
                    'node_modules/@overkill-dev/type-test/packages/type-test/adapter.entry-point.js'
                );
                await readFile(backend);
                await rm(backend);
                const script = `import {sameType} from '@overkill-dev/type-test';
import {typeTestProfile} from '@overkill-dev/type-test/profile';
import {checkTypeTests} from '@overkill-dev/type-test/check';
sameType();typeTestProfile({files:{include:['case.mts']},projectConfigPath:'tsconfig.json',compiler:{kind:'local'}});
if(typeof checkTypeTests!=='function')throw new Error('Missing check API');
console.log('lazy imports passed');`;
                const result = await runNode(directory, [ '--input-type=module', '--eval', script ]);
                scope.assert.equal(result.code, 0, { message: result.stderr });
                scope.assert.equal(result.stdout, 'lazy imports passed\n');
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
