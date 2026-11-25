import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { defaultRunRequest } from '../../../test-support/run-command-factory.ts';

export function serializedTypeTestRequest(overrides: Parameters<typeof defaultRunRequest>[0]): string {
    return inspect(defaultRunRequest(overrides), { depth: null });
}

const parityReporter = `import {defineReporter} from '@overkill-dev/engine';
export const events=[];
export const results=[];
const snapshot=value=>JSON.parse(JSON.stringify(value));
export const reporter=defineReporter(()=>({
    kind:'real-time',name:'parity events',sinks:[{kind:'memory'}],onFinish:null,dispose:null,
    onEvent(event) {
        const {kind,workId,verdict,outcome,attempt,completion}=event;
        if(kind==='run-start') events.push(snapshot({kind,family:event.facts.family}));
        if(kind==='test-start' || kind==='test-end') {
            events.push(snapshot({kind,workId,verdict,outcome,attempt,completion}));
        }
    }
}));
export const finalReporter=defineReporter(()=>({
    kind:'final-result',name:'parity result',sinks:[{kind:'memory'}],dispose:null,
    onResult({result}) { results.push(snapshot(evidence(result))); }
}));
export function evidence(result) {
    return result.perTest.map(({workId,verdict,outcome})=>({workId,verdict,outcome}));
}
`;

function parityProgram(request: string): string {
    return `import assert from 'node:assert/strict';
import {channel} from 'node:diagnostics_channel';
import {access,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {API,Program} from 'typescript-beta/async';
import * as engine from '@overkill-dev/engine';
import {family} from '@overkill-dev/type-test';
import {commandLineRunner} from '@overkill-dev/run/command-line';
import {testNode} from './runner.mts';
import {events,reporter,results,finalReporter,evidence} from './parity-reporter.mjs';

const cwd=await realpath(process.cwd());
const project=join(cwd,'tsconfig.json');
const source=join(cwd,'runner.mts');
const bytes=await readFile(source,'utf8');
const parseConfigFile=API.prototype.parseConfigFile;
const createSnapshot=API.prototype.createSnapshot;
let parsed=0;
let snapshots=0;
API.prototype.parseConfigFile=async function(path,...args) {
    assert.equal(path,project);
    const configuration=await parseConfigFile.call(this,path,...args);
    assert.deepEqual(configuration.fileNames,[source]);
    parsed++;
    return configuration;
};
API.prototype.createSnapshot=async function(options,...args) {
    const snapshot=await createSnapshot.call(this,options,...args);
    let program;
    if(options.createPrograms===undefined) {
        assert.deepEqual(options,{openProjects:[project]});
        program=snapshot.getConfiguredProject(project).program;
    } else {
        assert.equal(options.createPrograms.length,1);
        assert.deepEqual(options.createPrograms[0].rootFiles,[source]);
        assert.equal(options.createPrograms[0].compilerOptions.configFilePath,project);
        [program]=snapshot.operation.createdPrograms;
    }
    const names=await program.getSourceFileNames();
    assert.deepEqual(names.filter(path=>!relative(cwd,path).startsWith('node_modules/') &&
        !relative(cwd,path).startsWith('../')),[source]);
    for(const path of names) {
        if(path===source) continue;
        assert.ok(relative(cwd,path).startsWith('node_modules/'),path);
        assert.match(path,/[.]d[.](ts|mts|cts)$/);
        await access(path);
    }
    assert.equal((await program.getSourceFile(source)).text,bytes);
    snapshots++;
    return snapshot;
};
async function projectFiles() {
    const entries=await readdir(cwd);
    const inputs=entries.filter(name=>!['node_modules','parity-state'].includes(name));
    return Promise.all(inputs.sort().map(async name=>[name,await readFile(join(cwd,name),'utf8')]));
}
const before=await projectFiles();
const signal=new AbortController().signal;
const plan=engine.createTestPlanFromTestFiles({
    root:{title:cwd,annotations:{},controls:{}},files:[{file:'runner.mts',testNode}]
});
const settings={projectConfigPath:project,compiler:{kind:'package',specifier:'typescript-beta',version:'7.1.0-beta'}};
await using prepared=await engine.prepareFamily({testPlan:plan,testFamily:family,settings,projectRoot:cwd,signal});
const workIds=prepared.testPlan.cases.filter(item=>item.id.title!=='excluded').map(item=>item.workId);
const collected=await prepared.collect({workIds,signal});
const direct=await engine.execute(collected,{signal,debug:{mode:'off'},retryPolicy:null,
    reporters:[reporter,finalReporter],execution:{mode:'serial-in-process'},
    runFacts:{},startedAt:new Date().toISOString()});
const directEvents=events.splice(0);
const directFinal=results.pop();
assert.ok(parsed>0 && snapshots>0,'Expected the direct run to build the original program');
assert.deepEqual(await projectFiles(),before);

const request=${request};
const run=runRequest=>commandLineRunner.runTests({cwd,configPath:null,runRequest});
function diagnostics(reply) {
    const errors=reply.runResult?.runnerErrors.map(error=>error.cause?.stack ?? error.message) ?? [];
    return [...reply.fallbackDiagnostics,...errors].join('\\n');
}
parsed=0;
snapshots=0;
const reply=await run({...request,selection:{kind:'filter',filter:{
    kind:'any', filters:workIds.map(id=>({kind:'work-id',id}))
}}});
assert.ok(reply.runResult,diagnostics(reply));
assert.equal(reply.exitCode,1,diagnostics(reply));
assert.ok(parsed>0 && snapshots>0,'Expected the runner to build the original program');
assert.deepEqual(direct.perTest.map(item=>item.workId),workIds);
assert.deepEqual(direct.perTest.map(item=>item.verdict),['pass','fail','skip']);
assert.deepEqual(direct.runnerErrors,[]);
const failure=direct.perTest[1].outcome.failures[0].checks[0];
assert.deepEqual(failure.sourceLocations,[{kind:'known',file:source,line:12,column:9}]);
assert.deepEqual(evidence(reply.runResult),evidence(direct));
assert.deepEqual(events.splice(0),directEvents);
assert.deepEqual(directFinal,JSON.parse(JSON.stringify(evidence(direct))));
assert.deepEqual(results.pop(),directFinal);
assert.deepEqual(directEvents.filter(event=>event.kind==='test-end').map(event=>event.workId),workIds);
assert.ok(directEvents.filter(event=>event.kind==='test-end').every(event=>event.completion==='final'));
for(const id of workIds.slice(0,2)) {
    assert.equal(directEvents.filter(event=>event.kind==='test-start' &&
        JSON.stringify(event.workId)===JSON.stringify(id)).length,1);
}
const paths=await readdir('parity-state/runs');
assert.equal(paths.length,1);
const record=JSON.parse(await readFile(join('parity-state/runs',paths[0]),'utf8'));
assert.deepEqual(record.facts.family,directEvents[0].family);
const {preparation,collection}=record.facts.family;
assert.equal(preparation.compilers[0].version,'7.1.0-beta');
assert.ok(preparation.compilers[0].projectFingerprint);
assert.deepEqual(collection.compilers[0].assertions.map(site=>site.owners),workIds.slice(0,2).map(id=>[id]));
assert.deepEqual(record.result.perTest.map(item=>[item.workId,item.verdict]),
    direct.perTest.map(item=>[item.workId,item.verdict]));
const recordedCheck={...failure,error:{...failure.error,thrown:engine.serializeValue(failure.error.thrown)}};
assert.deepEqual(record.result.perTest[1].outcome,{
    kind:'fail',failures:[{kind:'assertion',checks:[recordedCheck]}]
});

let emptyShards=0;
for(const index of [1,2]) {
    const shard=await run({...request,record:false,shard:{index,total:2},selection:{
        kind:'filter',filter:{kind:'work-id',id:workIds[0]}
    }});
    assert.equal(shard.exitCode,0,'Shard '+index+': '+diagnostics(shard));
    const shardEvents=events.splice(0);
    const start=shardEvents.find(event=>event.kind==='run-start');
    if(shard.runResult.perTest.length===0) {
        assert.equal(shard.runResult.planStatus,'empty-shard');
        assert.ok(shardEvents.every(event=>event.kind!=='test-end' && event.kind!=='test-start'));
        assert.ok(start.family.preparation.compilers[0].projectFingerprint);
        assert.equal(start.family.collection,null);
        emptyShards++;
    }
}
assert.equal(emptyShards,1);
assert.deepEqual(await projectFiles(),before);
const compilerProcesses=new Set();
const compilerProcessChannel=channel('child_process');
function observeCompiler({process:child}) {
    child.once('spawn',()=>{
        if (!child.spawnargs.includes('--api')) return;
        compilerProcesses.add(child);
        child.once('close',()=>compilerProcesses.delete(child));
    });
}
await writeFile(project,(await readFile(project,'utf8'))+'\\n');
const cancellation=new AbortController();
const semanticDiagnostics=Program.prototype.getSemanticDiagnostics;
const processesAtRunEnd=[];
const shutdownReporter=engine.defineReporter(()=>({
    kind:'real-time',name:'compiler shutdown',sinks:[{kind:'memory'}],onFinish:null,dispose:null,
    onEvent(event) {
        if(event.kind==='run-end') processesAtRunEnd.push(compilerProcesses.size);
    }
}));
async function checkOne(signal) {
    await using prepared=await engine.prepareFamily({testPlan:plan,testFamily:family,settings,projectRoot:cwd,signal});
    const collected=await prepared.collect({workIds:[workIds[0]],signal});
    return await engine.execute(collected,{signal,debug:{mode:'off'},retryPolicy:null,reporters:[shutdownReporter],
        execution:{mode:'serial-in-process'},runFacts:{},startedAt:new Date().toISOString()});
}
let interrupted=false;
compilerProcessChannel.subscribe(observeCompiler);
try {
    Program.prototype.getSemanticDiagnostics=function(...args) {
        const pending=semanticDiagnostics.apply(this,args);
        interrupted=compilerProcesses.size>0;
        cancellation.abort(new Error('cancel type checking'));
        return pending;
    };
    const cancelled=await checkOne(cancellation.signal);
    assert.ok(interrupted,'Expected cancellation while the real compiler was checking');
    assert.deepEqual(cancelled.perTest.map(item=>item.verdict),['inconclusive']);
    assert.ok(cancelled.runnerErrors.some(error=>error.message.includes('cancel type checking')));
    assert.equal(compilerProcesses.size,0);
    Program.prototype.getSemanticDiagnostics=semanticDiagnostics;
    const recovered=await checkOne(signal);
    assert.deepEqual(recovered.runnerErrors,[]);
    assert.deepEqual(recovered.perTest.map(item=>item.verdict),['pass']);
    assert.deepEqual(processesAtRunEnd,[0,0]);
    assert.equal(compilerProcesses.size,0);
} finally {
    Program.prototype.getSemanticDiagnostics=semanticDiagnostics;
    compilerProcessChannel.unsubscribe(observeCompiler);
}
console.log('engine and runner delivered original-source evidence');
`;
}

const parityCases = `import * as engine from '@overkill-dev/engine';
import {sameType} from '@overkill-dev/type-test';
const metadata={annotations:{},controls:{},definitionLocations:[{kind:'unknown'}]} as const;
function mustNotRun(): void { throw new Error('Static body ran'); }
export const testNode=engine.createSuite({...metadata,title:'root',children:[
    engine.createTestCase({...metadata,title:'selected z',body(scope){
        mustNotRun();
        scope.assert(sameType<string,string>());return scope.assert.collect();
    }}),
    engine.createTestCase({...metadata,title:'selected a',body(scope){
        mustNotRun();
        scope.assert(sameType<string,number>());return scope.assert.collect();
    }}),
    engine.createSkippedTestCase({...metadata,title:'skipped',reason:'authored skip'}),
    engine.createTestCase({...metadata,title:'excluded',body(scope){
        scope.assert(sameType<number,boolean>());return scope.assert.collect();
    }})
]});`;

export async function writeParityProject(directory: string): Promise<void> {
    const configPath = join(directory, 'overkill.config.js');
    const config = await readFile(configPath, 'utf8');
    const configWithReporters = config.replace(
        'defineConfig({profiles:',
        "defineConfig({runtimeStateDir:'parity-state',reporters:[reporter,finalReporter],profiles:"
    );
    const timedConfig = configWithReporters.replace(
        'testFamily:family,',
        'testFamily:family,timeouts:{collectionMilliseconds:60000,softMilliseconds:60000},'
    );
    const request = serializedTypeTestRequest({ order: 'lexical', profile: 'types', record: true });
    await Promise.all([
        writeFile(
            configPath,
            `import {reporter,finalReporter} from './parity-reporter.mjs';
${timedConfig}`
        ),
        mkdir(join(directory, 'parity-state')),
        writeFile(join(directory, 'runner.mts'), parityCases),
        writeFile(join(directory, 'parity-reporter.mjs'), parityReporter),
        writeFile(join(directory, 'parity.mjs'), parityProgram(request))
    ]);
}
