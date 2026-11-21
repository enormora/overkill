export const strykerWorkerReuseScript = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const [adapter, engine, configApi, instrumenter] = process.argv.slice(1);
const { strykerPlugins } = await import(adapter);
const { Instrumenter } = await import(instrumenter);
const logger = { info() {}, debug() {}, isDebugEnabled: () => false };
const caseTimeoutMilliseconds=2000;
const instrumented = await new Instrumenter(logger).instrument([
    { name: process.cwd() + '/subject.mjs', content: 'export function value() { return true; }', mutate: true }
], { excludedMutations: ['BlockStatement'], ignorers: [], plugins: null });
await writeFile('package.json', '{"type":"module"}');
await writeFile('subject.mjs', instrumented.files[0].content);
await writeFile('case.test.mjs',
    'import { createTestCase } from ' + JSON.stringify(engine) + ';' +
    'import { AsyncResource } from "node:async_hooks";' +
    'import { channel } from "node:diagnostics_channel";' +
    'import { value } from "./subject.mjs";' +
    'export const state = { mode: "pass", runs: 0, cleanups: [], scopes: [], processIds: [],' +
    ' gate: null, late: null, timer: null, lateDone: null };' +
    'export const testNode = createTestCase({ annotations: {}, controls: {},' +
    'definitionLocations: [{kind:"unknown"}], title: "reused case", async body(scope) {' +
    'state.runs++;state.processIds.push(process.pid);state.scopes.push(scope);' +
    'const invocation=state.runs;scope.cleanup(()=>{state.cleanups.push(invocation);});' +
    'if(state.mode.endsWith("-cleanup-error"))scope.cleanup(()=>{throw new Error("cleanup sentinel");});' +
    'if(state.mode.endsWith("-cleanup-delay"))scope.cleanup(()=>{' +
    ' const deadline=performance.now()+'+(caseTimeoutMilliseconds+100)+';while(performance.now()<deadline){};});' +
    'value();scope.assert.true(true);' +
    'if(["timeout","rejection","exception"].some(mode=>state.mode.startsWith(mode))) {' +
    ' state.late=new AsyncResource("stale mutation attempt");' +
    ' if(state.mode.startsWith("rejection"))Promise.reject(new Error("rejection sentinel"));' +
    ' if(state.mode.startsWith("exception"))queueMicrotask(()=>{throw new Error("exception sentinel");});' +
    ' await state.gate.promise;state.lateDone.resolve();' +
    '}' +
    'if(state.mode === "leak") {state.gate=Promise.withResolvers();void state.gate.promise;}' +
    'if(state.mode.startsWith("late-")) {' +
    ' state.late.runInAsyncScope(()=>{' +
    '  if(state.mode === "late-console")channel("console.log").publish({});' +
    '  if(state.mode === "late-permission")channel("node:permission-model:fs").publish({' +
    '   permission:"FileSystemWrite",resource:"stale-permission"});' +
    '  if(state.mode === "late-rejection")Promise.reject(new Error("late rejection sentinel"));' +
    '  if(state.mode === "late-exception")queueMicrotask(()=>{throw new Error("late exception sentinel");});' +
    '  if(state.mode === "late-resource")state.timer=setTimeout(()=>{},60000);' +
    ' });await new Promise(resolve=>setImmediate(resolve));' +
    '}' +
    'return scope.assert.collect();} });');
await writeFile('overkill.config.mjs', 'import {defineConfig} from ' + JSON.stringify(configApi) + ';' +
    'export const config=defineConfig({profiles:{microtest:{testFamily:"microtest",' +
    'files:{include:["case.test.mjs"]},execution:{processModel:"in-process",scheduling:"serial"},' +
    'timeouts:{collectionMilliseconds:30000,softMilliseconds:'+caseTimeoutMilliseconds+
    ',hardMilliseconds:'+(caseTimeoutMilliseconds*2)+'}}}});');
const runner = strykerPlugins[0].factory({overkill:{configPath:'overkill.config.mjs',seed:'42'}},
    {[process.cwd()+'/subject.mjs']:{mutate:true}}, logger);
const listeners = () => ['uncaughtException','unhandledRejection','newListener','message']
    .map(event=>[event,process.listeners(event)]);
const dryOptions={coverageAnalysis:'off',timeout:30000,disableBail:false};
let state;
try {
    await runner.init();
    const dry=await runner.dryRun(dryOptions);
    assert.equal(dry.status,'complete',JSON.stringify(dry));
    ({state}=await import('./case.test.mjs'));
    const capabilities=await runner.capabilities();
    assert.deepEqual(capabilities,{reloadEnvironment:false});
    const baselineListeners=listeners();
    const namespace=globalThis.__stryker__;
    const coverage=namespace.mutantCoverage;
    const buckets=[coverage.static,coverage.perTest];
    const mutant=instrumented.mutants.find(mutant=>mutant.mutatorName === 'BooleanLiteral');
    assert.ok(mutant);
    const input={activeMutant:mutant,mutantActivation:'runtime',reloadEnvironment:false,
        sandboxFileName:process.cwd()+'/subject.mjs',timeout:30000,disableBail:false};
    const completed=[];
    async function invoke(mode,expected) {
        state.mode=mode;
        const result=await runner.mutantRun(input);
        assert.equal(result.status,expected,JSON.stringify(result));
        assert.deepEqual(await runner.capabilities(),capabilities);
        assert.deepEqual(listeners(),baselineListeners);
        assert.equal(globalThis.__stryker__,namespace);
        assert.equal(namespace.mutantCoverage,coverage);
        assert.equal(coverage.static,buckets[0]);assert.equal(coverage.perTest,buckets[1]);
        for(const key of ['currentTestId','activeMutant','hitCount','hitLimit']) {
            assert.equal(namespace[key],undefined,key);
        }
        assert.equal(process.env.__STRYKER_ACTIVE_MUTANT__,undefined);
        assert.equal(state.scopes.at(-1).signal.aborted,true);
        assert.equal(state.cleanups.at(-1),state.runs);
        if(expected === 'killed')assert.deepEqual(result.killedBy,[dry.tests[0].id]);
        if(expected === 'error')assert.equal(result.killedBy,undefined);
        completed.push([result,structuredClone(result)]);
        return result;
    }
    for(const unsafe of ['timeout','rejection','exception','leak']) {
        state.gate=Promise.withResolvers();state.lateDone=Promise.withResolvers();
        await invoke(unsafe,unsafe === 'timeout' ? 'timeout' : 'killed');
        await invoke('pass','survived');
        const cleanupSnapshot=Array.from(state.cleanups);
        state.gate.resolve();
        if(unsafe !== 'leak')await state.lateDone.promise;
        await new Promise(resolve=>setImmediate(resolve));
        assert.deepEqual(state.cleanups,cleanupSnapshot);
        for(const [result,snapshot] of completed)assert.deepEqual(result,snapshot);
        if(unsafe !== 'leak') {
            for(const observation of ['console','permission','rejection','exception','resource']) {
                const result=await invoke('late-'+observation,'error');
                const diagnostic={console:/console/,permission:/permission|FileSystemWrite/,
                    rejection:/late rejection sentinel/,exception:/late exception sentinel/,resource:/resource/};
                assert.match(result.errorMessage,diagnostic[observation]);
                clearTimeout(state.timer);state.timer=null;
                await invoke('pass','survived');
            }
            state.late.emitDestroy();state.late=null;
        }
    }
    for(const interruption of ['timeout','rejection','exception']) {
        state.gate=Promise.withResolvers();state.lateDone=Promise.withResolvers();
        const failed=await invoke(interruption+'-cleanup-error','error');
        assert.match(failed.errorMessage,/cleanup sentinel/);
        state.gate.resolve();await state.lateDone.promise;
        state.late.emitDestroy();state.late=null;
        await invoke('pass','survived');
    }
    for(const interruption of ['rejection','exception']) {
        state.gate=Promise.withResolvers();state.lateDone=Promise.withResolvers();
        await invoke(interruption+'-cleanup-delay','timeout');
        state.gate.resolve();await state.lateDone.promise;
        state.late.emitDestroy();state.late=null;
        await invoke('pass','survived');
    }
    const repeated=await runner.dryRun(dryOptions);
    assert.equal(repeated.status,'complete',JSON.stringify(repeated));
    assert.deepEqual(repeated.tests.map(test=>test.id),dry.tests.map(test=>test.id));
    assert.equal(new Set(state.scopes).size,state.runs);
    assert.deepEqual(state.cleanups,Array.from({length:state.runs},(_,index)=>index+1));
    assert.deepEqual(new Set(state.processIds),new Set([process.pid]));
} finally {
    state?.gate?.resolve();clearTimeout(state?.timer);state?.late?.emitDestroy();
    await runner.dispose();
}
console.log('worker reuse passed');
`;

export const strykerHungCleanupScript = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const [core,adapter,engine,configApi]=process.argv.slice(1);
const {Stryker}=await import(core);
await writeFile('package.json','{"type":"module"}');
await writeFile('subject.mjs','export function value(){return true;}');
await writeFile('case.test.mjs','import {createTestCase} from '+JSON.stringify(engine)+';'+
    'import {value} from "./subject.mjs";'+
    'export const testNode=createTestCase({annotations:{},controls:{},'+
    'definitionLocations:[{kind:"unknown"}],title:"hung cleanup",body(scope){'+
    'scope.cleanup(()=>{if(!value())return new Promise(()=>{});});'+
    'scope.assert.true(true);return scope.assert.collect();}});');
await writeFile('overkill.config.mjs','import {defineConfig} from '+JSON.stringify(configApi)+';'+
    'export const config=defineConfig({profiles:{microtest:{testFamily:"microtest",'+
    'files:{include:["case.test.mjs"]},execution:{processModel:"in-process",scheduling:"serial"},'+
    'timeouts:{collectionMilliseconds:30000,softMilliseconds:500,hardMilliseconds:1000}}}});');
const results=await new Stryker({testRunner:'overkill',plugins:[adapter],mutate:['subject.mjs'],
    files:['package.json','subject.mjs','case.test.mjs','overkill.config.mjs'],
    testFiles:['case.test.mjs'],overkill:{configPath:'overkill.config.mjs',seed:'42'},
    mutator:{excludedMutations:['BlockStatement']},concurrency:1,maxTestRunnerReuse:100,
    reporters:[],logLevel:'off',fileLogLevel:'off',timeoutMS:3000,dryRunTimeoutMinutes:1,
    coverageAnalysis:'off',cleanTempDir:true,tempDirName:'.stryker-tmp'}).runMutationTest();
const booleans=results.filter(result=>result.mutatorName === 'BooleanLiteral');
assert.equal(booleans.length,1,JSON.stringify(results));
assert.equal(booleans[0].status,'Timeout',JSON.stringify(results));
process.report.excludeEnv=true;process.report.excludeNetwork=true;
const {setTimeout}=await import('node:timers/promises');
const children=()=>process.report.getReport().libuv.filter(handle=>handle.type === 'process' && handle.pid>0);
const deadline=performance.now()+5000;
while(children().length>0 && performance.now()<deadline)await setTimeout(20);
assert.deepEqual(children(),[]);
console.log('hung cleanup passed');
`;
