import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function sourceModule(path: string): string {
    const module = new URL(path, import.meta.url);
    return JSON.stringify(module.href);
}
export type ProjectedResourceScope = 'per-file' | 'per-run' | 'per-suite';
function declaration(log: string, scope: ProjectedResourceScope): string {
    return [
        `import {suite,test,defineBodyReference} from ${sourceModule('../packages/test/test.entry-point.ts')};`,
        'import {defineImplementationReference,defineResourceReference,defineResourceOwnerReference,',
        `defineResourceConsumerReference} from ${sourceModule('../packages/resources/resources.entry-point.ts')};`,
        `import {withResources} from ${sourceModule('../packages/test/resources.entry-point.ts')};`,
        'function reference(file,name,input,dynamicModules=[]){return defineImplementationReference({',
        "module:{moduleUrl:new URL(file,import.meta.url).href,exportName:name},realm:'host',version:'1',",
        'input,dynamicModules,parseInput(value){return value;}});}',
        "const close={moduleUrl:new URL('./close.mjs',import.meta.url).href,exportName:'close'};",
        `const owner=defineResourceOwnerReference(reference('./owner.mjs','owner',{log:${
            JSON.stringify(log)
        }},[close]));`,
        "const consumer=defineResourceConsumerReference(reference('./consumer.mjs','consumer',null));",
        `const native=defineResourceReference({name:'native',scope:${
            JSON.stringify(scope)
        },requirements:[],dependencies:{},`,
        'scenarios:{},workload:null,owner,consumer});',
        "const body=defineBodyReference(reference('./body.mjs','body',null));",
        "export const testNode=suite('portable',[test('first',withResources({native},body)),",
        "test('second',withResources({native},body))]);"
    ]
        .join('\n');
}
function owner(log: string): string {
    return [
        "import {appendFileSync} from 'node:fs';import {threadId} from 'node:worker_threads';",
        `appendFileSync(${JSON.stringify(log)},'loaded '+process.pid+':'+threadId+'\\n');`,
        "export const owner={version:'1',implementation:{",
        "acquire(context,input){appendFileSync(input.log,'acquired\\n');return new URL('https://example.test/');},",
        "async dispose(handle,context,input){const name='close';",
        "const {close}=await import('./'+name+'.mjs');close(input.log);},",
        'exposeHandle:null,serializeHandle(handle){return {href:handle.href};}}};'
    ]
        .join('\n');
}
export async function writeImplementationProject(directory: string, scope: ProjectedResourceScope): Promise<string> {
    const log = join(directory, 'lifetime.log');
    await writeFile(log, '');
    await writeFile(join(directory, 'owner.mjs'), owner(log));
    await writeFile(
        join(directory, 'close.mjs'),
        [
            "import {appendFileSync} from 'node:fs';",
            "export function close(log){appendFileSync(log,'disposed\\n');}"
        ]
            .join('\n')
    );
    await writeFile(
        join(directory, 'consumer.mjs'),
        [
            "export const consumer={version:'1',implementation:{",
            'deserializeHandle(payload){return payload.href;},exposeHandle:null}};'
        ]
            .join('\n')
    );
    await writeFile(
        join(directory, 'body.mjs'),
        [
            "export const body={version:'1',implementation(scope){",
            "scope.assert.equal(scope.resources.native,'https://example.test/');return scope.assert.collect();}};"
        ]
            .join('\n')
    );
    await writeFile(join(directory, 'portable.test.mjs'), declaration(log, scope));
    return log;
}
