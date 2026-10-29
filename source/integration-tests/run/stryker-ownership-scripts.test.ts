const ownershipProject = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawn, fork } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { pathToFileURL } from 'node:url';
const [adapter, engine, configApi, instrumenter, processModel, runApi] = process.argv.slice(1);
const children = new Set();
const closed = new Map();
const fixtureProcesses = new Set();
let ready = Promise.withResolvers();
const spawned = channel('child_process');
function observeChild(message) {
    const child = message.process;
    child.once('spawn',()=>{
        if(fixtureProcesses.has(child))return;
        children.add(child);
        closed.set(child,new Promise(resolve=>child.once('close',()=>{children.delete(child);resolve();})));
        let output='';
        child.stdout?.on('data',chunk=>{
            output+=chunk.toString();
            if(output.includes('owned invocation ready\\n'))ready.resolve(child);
        });
    });
}
async function waitForOwnedOperation(promise, description) {
    let timer;
    try {
        return await Promise.race([promise,new Promise((resolve,reject)=>{
            timer=setTimeout(()=>reject(new Error(description+' did not finish')),30000);
        })]);
    } finally {clearTimeout(timer);}
}
async function assertReaped() {
    await waitForOwnedOperation(Promise.all(closed.values()),'owned child shutdown');
    assert.equal(children.size,0);
    for(const child of closed.keys())assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
}
const sentinel=spawn(process.execPath,
    ['--eval','setInterval(()=>{},1000)','overkill-mutation-sentinel'],{stdio:'ignore'});
fixtureProcesses.add(sentinel);
const sentinelClosed=new Promise(resolve=>sentinel.once('close',resolve));
await new Promise((resolve,reject)=>{sentinel.once('spawn',resolve);sentinel.once('error',reject);});
spawned.subscribe(observeChild);
async function disposeOwnershipFixture() {
    spawned.unsubscribe(observeChild);
    for(const child of children)child.kill('SIGKILL');
    try {await waitForOwnedOperation(Promise.all(closed.values()),'fixture child shutdown');}
    finally {sentinel.kill('SIGKILL');await sentinelClosed;}
}
try {
await writeFile('package.json','{"type":"module"}');
await writeFile('overkill.config.mjs','import {defineConfig} from '+JSON.stringify(configApi)+';'+
    'export const config=defineConfig('+JSON.stringify({profiles:{microtest:{testFamily:'microtest',
        files:{include:['case.test.mjs']},execution:{processModel,scheduling:'serial'},
        timeouts:{collectionMilliseconds:30000,softMilliseconds:30000,hardMilliseconds:60000}
    }}})+');');
`;

export const strykerCancellationScript = `${ownershipProject}
const {orchestrator,normalizeConfig} = await import(runApi);
await writeFile('case.test.mjs','import {createTestCase} from '+JSON.stringify(engine)+';'+
    'export const testNode=createTestCase({annotations:{},controls:{},definitionLocations:[{kind:"unknown"}],'+
    'title:"cancellation control",body(scope){scope.assert.true(true);return scope.assert.collect();}});');
await writeFile('lifecycle.mjs',
    'export async function createLifecycle(mode){return {'+
    'async select(){return {kind:"all"};},async beforeCases(){'+
    'if(mode === "pending"){process.stdout.write("owned invocation ready\\\\n");while(true){}}},'+
    'async enterCase(){},async completeCase(){return "continue";},snapshot(){return null;},async dispose(){}};}');
const {config} = await import(pathToFileURL(process.cwd()+'/overkill.config.mjs').href);
const normalized=normalizeConfig(config);
const policy=await orchestrator.freezePolicy({moduleBoundary:null,source:{kind:'memory'},command:{
    config:normalized,cwd:process.cwd(),engine:{kind:'default'},request:{
        baselineUpdateMode:'none',capabilityRestrictions:{mode:'enabled'},capture:'buffered',coverage:false,
        record:false,
        debug:{mode:'off',selectors:[]},execution:{mode:'serial'},measureProcessUsage:null,order:'seeded',
        paths:[],profile:'microtest',processBudgetOverrides:null,processUsageSamplingIntervalMilliseconds:null,
        seed:{value:42n},selection:{kind:'all'},shard:{index:1,total:1},timingCollection:'profile-default',
        verbose:false,workers:null
    }
}});
const session=orchestrator.createExecutionSession({command:{kind:'frozen-policy',policy,
    invocation:{seed:{value:42n},selection:{kind:'all'}},
    reporting:{outputRenderer:normalized.outputRenderer,reporters:[]}},
    lifecycle:{moduleUrl:pathToFileURL(process.cwd()+'/lifecycle.mjs').href,exportName:'createLifecycle'},
    environment:processModel === 'in-process' ? 'fresh-invocation' : 'profile-default'});
try {
    const cancelled=await session.run({data:'pass',timeoutMilliseconds:30000,
        signal:AbortSignal.abort(new Error('cancelled before invocation'))});
    assert.equal(cancelled.kind,'failure',JSON.stringify(cancelled));
    assert.equal(cancelled.failure.message,'cancelled before invocation');
    assert.equal(closed.size,0);
    const controller=new AbortController();
    const running=session.run({data:'pending',timeoutMilliseconds:30000,signal:controller.signal});
    await waitForOwnedOperation(ready.promise,'invocation readiness');
    controller.abort(new Error('cancelled active invocation'));
    const interrupted=await waitForOwnedOperation(running,'cancelled invocation');
    assert.equal(interrupted.kind,'failure',JSON.stringify(interrupted));
    assert.match(JSON.stringify(interrupted),/aborted|cancelled/i);
    await assertReaped();
    assert.equal(process.kill(sentinel.pid,0),true);
    const subsequent=await session.run({data:'pass',timeoutMilliseconds:30000,signal:null});
    assert.equal(subsequent.kind,'result',JSON.stringify(subsequent));
    assert.equal(subsequent.result.status,'passed',JSON.stringify(subsequent));
    assert.equal(subsequent.result.summary.passed,1);
    await assertReaped();
    ready=Promise.withResolvers();
    const disposing=session.run({data:'pending',timeoutMilliseconds:30000,signal:null});
    await waitForOwnedOperation(ready.promise,'disposal readiness');
    await waitForOwnedOperation(session.dispose(),'session disposal');
    assert.equal((await disposing).kind,'failure');
    await assertReaped();
    await assert.rejects(session.run({data:'pass',timeoutMilliseconds:30000,signal:null}),/disposed/);
    await session.dispose();
    assert.equal(process.kill(sentinel.pid,0),true);
} finally {await session.dispose();}
} finally {await disposeOwnershipFixture();}
console.log('ownership passed');
`;

export const strykerDisconnectScript = `${ownershipProject}
const {strykerValidationSchema} = await import(adapter);
const {Instrumenter} = await import(instrumenter);
const instrumented=await new Instrumenter({info(){},debug(){},isDebugEnabled:()=>false}).instrument([
    {name:process.cwd()+'/subject.mjs',content:'export function value(){return true;}',mutate:true}
],{excludedMutations:['BlockStatement'],ignorers:[],plugins:null});
await writeFile('subject.mjs',instrumented.files[0].content);
const mutant=instrumented.mutants.find(candidate=>candidate.mutatorName === 'BooleanLiteral');
assert.ok(mutant);
await writeFile('case.test.mjs','import {createTestCase} from '+JSON.stringify(engine)+';'+
    'import {value} from "./subject.mjs";'+
    'export const testNode=createTestCase({annotations:{},controls:{},definitionLocations:[{kind:"unknown"}],'+
    'title:"disconnected invocation",body(scope){'+
    'if(!value()){process.stdout.write("owned invocation ready\\\\n");while(true){}}'+
    'scope.assert.true(true);return scope.assert.collect();}});');
const endpoint=strykerValidationSchema.properties.overkillCampaign.default;
assert.ok(endpoint);
await writeFile('plugin-worker.mjs','import {strykerPlugins} from '+JSON.stringify(adapter)+';'+
    'const runner=strykerPlugins[0].factory('+JSON.stringify({overkillCampaign:endpoint,
        overkill:{configPath:'overkill.config.mjs',freshState:processModel === 'in-process',seed:'42'}})+','+
    JSON.stringify({[process.cwd()+'/subject.mjs']:{mutate:true}})+',{info(){}});'+
    'process.on("message",async()=>{const result=await runner.mutantRun('+JSON.stringify({activeMutant:mutant,
        mutantActivation:'runtime',reloadEnvironment:false,sandboxFileName:process.cwd()+'/subject.mjs',
        timeout:120000,disableBail:true})+');process.send({kind:"completed",result});});'+
    'await runner.init();const dry=await runner.dryRun({coverageAnalysis:"perTest",timeout:30000,disableBail:true});'+
    'if(dry.status!=="complete")throw new Error(JSON.stringify(dry));process.send({kind:"ready"});');
const worker=fork(process.cwd()+'/plugin-worker.mjs',[],{execArgv:[],
    env:{...process.env,STRYKER_MUTATOR_WORKER:'0'},stdio:['ignore','pipe','pipe','ipc']});
fixtureProcesses.add(worker);
const workerClosed=new Promise(resolve=>worker.once('close',resolve));
let completed=false;
let stderr='';worker.stderr.on('data',chunk=>{stderr+=chunk.toString();});
const registered=new Promise((resolve,reject)=>{
    worker.on('message',message=>{
        if(message.kind === 'ready')resolve();
        if(message.kind === 'completed')completed=true;
    });
    worker.once('error',reject);
    worker.once('exit',()=>reject(new Error('Plugin worker exited before registration: '+stderr)));
});
try {
    await waitForOwnedOperation(registered,'plugin registration');
    ready=Promise.withResolvers();
    worker.send({kind:'invoke'});
    const host=await waitForOwnedOperation(ready.promise,'blocked invocation readiness');
    assert.equal(process.kill(host.pid,0),true);
    assert.equal(host.exitCode,null);assert.equal(host.signalCode,null);
    const disconnectedAt=performance.now();
    worker.kill('SIGKILL');
    await waitForOwnedOperation(workerClosed,'plugin worker shutdown');
    assert.equal(worker.signalCode,'SIGKILL');
    await assertReaped();
    assert.ok(performance.now()-disconnectedAt<10000,'Disconnect cleanup waited for a deadline');
    assert.equal(completed,false);
    assert.equal(process.kill(sentinel.pid,0),true);
} finally {
    worker.kill('SIGKILL');await waitForOwnedOperation(workerClosed,'fixture worker shutdown');
}
} finally {await disposeOwnershipFixture();}
console.log('ownership passed');
`;
