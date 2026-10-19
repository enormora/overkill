export const strykerTimeoutScript = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const [adapter, engine, configApi, instrumenter, processModel, scenario] = process.argv.slice(1);
const { strykerPlugins } = await import(adapter);
const { Instrumenter } = await import(instrumenter);
const logger = {info(){},debug(){},isDebugEnabled(){return false;}};
const staticActivation = scenario === 'static-hit-limit' || scenario.startsWith('config-');
const subject = (scenario === 'static-hit-limit' ? 'export const initial=true;' : '')+
    'export function value(){return true;}';
const instrumented = await new Instrumenter(logger).instrument([
    {name:process.cwd()+'/subject.mjs',content:subject,mutate:true}
], {excludedMutations:['BlockStatement'],ignorers:[],plugins:null});
await writeFile('subject.mjs',instrumented.files[0].content);
const mutant = instrumented.mutants.find(candidate=>candidate.mutatorName === 'BooleanLiteral');
assert.ok(mutant);
const cleanup = scenario === 'cleanup' || scenario === 'hit-limit' || scenario === 'hit-limit-error';
const hitLimit = scenario.includes('hit-limit');
const soft = scenario.includes('soft');
const controls = scenario === 'case-soft' ? {timeoutMilliseconds:1000} : {};
const slowBody = 'scope.assert.true(true);if(!value()){'+
    'await new Promise(resolve=>setTimeout(resolve,1500));return {kind:"pass"};}';
const body = cleanup
    ? (scenario === 'hit-limit-error'
        ? 'scope.cleanup(()=>{if(globalThis.__stryker__.activeMutant !== undefined){'+
          'throw new Error("cleanup sentinel");}});' : '')+
      'scope.cleanup(()=>{'+(hitLimit ? 'value();' : 'if(!value()){while(true){}}')+'});'
    : soft ? slowBody : 'if(!value()){while(true){}}';
const first = scenario === 'continued'
    ? 'createTestCase({...metadata,title:"first",body(scope){'+
      'scope.assert.true(value());return scope.assert.collect();}}),'
    : '';
await writeFile('case.test.mjs','import {createSuite,createTestCase} from '+JSON.stringify(engine)+';'+
    'import {value} from "./subject.mjs";'+
    'const metadata={annotations:{},controls:'+JSON.stringify(controls)+',definitionLocations:[{kind:"unknown"}]};'+
    'export const testNode=createSuite({...metadata,title:"timeouts",children:['+first+
    'createTestCase({...metadata,title:"affected",async body(scope){'+body+
    'scope.assert.true(true);return scope.assert.collect();}})]});');
const configuration={profiles:{microtest:{testFamily:'microtest',files:{include:['case.test.mjs']},
    execution:{processModel,scheduling:'serial'},timeouts:{collectionMilliseconds:30000,
    softMilliseconds:scenario === 'hard' || scenario === 'soft' || scenario === 'soft-reused' ? 1000 : 30000,
    hardMilliseconds:scenario === 'hard' ? 1500 : scenario === 'soft' || scenario === 'soft-reused' ? 3000 : 60000}}}};
const configEffect = scenario.startsWith('config-')
    ? 'import {value} from "./subject.mjs";'+(scenario === 'config-hit-limit-error'
        ? 'try{value();}catch{};if(globalThis.__stryker__.activeMutant !== undefined){'+
          'throw new Error("configuration sentinel");}' : 'value();') : '';
const configText='import {defineConfig} from '+JSON.stringify(configApi)+';'+configEffect+
    'export const config=defineConfig('+JSON.stringify(configuration)+');';
await writeFile('overkill.config.mjs',scenario.endsWith('startup') ? 'while(true){}' : configText);
const runner = strykerPlugins[0].factory({overkill:{configPath:'overkill.config.mjs',
    freshState:scenario !== 'soft-reused',seed:'42'}},{[process.cwd()+'/subject.mjs']:{mutate:true}},logger);
process.report.excludeEnv=true;
process.report.excludeNetwork=true;
const sentinel=scenario === 'dispose'
    ? spawn(process.execPath,['--eval','setInterval(()=>{},1000)'],{stdio:'ignore'}) : null;
const sentinelClosed=sentinel === null ? Promise.resolve() : new Promise(resolve=>sentinel.once('close',resolve));
const children=()=>process.report.getReport().libuv.filter(handle=>
    handle.type === 'process' && handle.pid>0 && handle.pid !== sentinel?.pid);
try {
    if(scenario.endsWith('startup')) {
        let initializationEnded=false;
        const initializing=scenario === 'pending-startup'
            ? runner.init().then(()=>{initializationEnded=true;return null;},error=>{
                initializationEnded=true;return error;
            }) : null;
        if(initializing !== null) {
            while(children().length === 0){assert.equal(initializationEnded,false);await setTimeout(10);}
        }
        const started=performance.now();
        const dry=await runner.dryRun({coverageAnalysis:'off',timeout:1500,disableBail:false});
        assert.equal(dry.status,'timeout',JSON.stringify(dry));
        assert.ok(performance.now()-started<11500,'startup deadline exceeded cleanup allowance');
        if(initializing !== null){assert.ok(await initializing instanceof Error);}
    } else {
        const dry=await runner.dryRun({coverageAnalysis:'off',timeout:30000,disableBail:false});
        assert.equal(dry.status,'complete',JSON.stringify(dry));
        if(scenario === 'collection') {await writeFile('case.test.mjs','while(true){}');}
        const input={activeMutant:mutant,mutantActivation:staticActivation ? 'static' : 'runtime',
            reloadEnvironment:false,
            sandboxFileName:process.cwd()+'/subject.mjs',disableBail:scenario === 'continued',
            timeout:scenario === 'dispose' || scenario === 'hard' || soft ? 30000
                : scenario === 'continued' ? 15000 : 5000,
            ...(hitLimit ? {hitLimit:0} : {})};
        const started=performance.now();
        const executing=runner.mutantRun(input);
        if(scenario === 'dispose') {
            while(children().length === 0){await setTimeout(10);}
            await runner.dispose();
        }
        const result=await executing;
        const deadline=scenario === 'hard' ? 1500 : input.timeout;
        assert.ok(performance.now()-started<deadline+10000,'invocation exceeded cleanup allowance');
        const expected=scenario === 'dispose' || scenario.endsWith('-error') ? 'error' : 'timeout';
        assert.equal(result.status,expected,JSON.stringify(result));
        if(scenario === 'continued') {
            assert.ok(result.reason.includes(dry.tests[0].id),JSON.stringify(result));
            assert.match(result.reason,/assertion/);
        }
        if(scenario === 'hit-limit-error'){assert.match(result.errorMessage,/cleanup sentinel/);}
        if(scenario === 'config-hit-limit-error'){assert.match(result.errorMessage,/configuration sentinel/);}
        if(scenario === 'soft' || scenario === 'soft-reused'){assert.match(result.reason,/deadlineMilliseconds: 1000/);}
        if(scenario === 'body' || scenario === 'hard') {
            const repeated=await runner.dryRun({coverageAnalysis:'off',timeout:30000,disableBail:false});
            assert.equal(repeated.status,'complete',JSON.stringify(repeated));
        }
    }
    assert.deepEqual(children(),[]);
    if(sentinel !== null){assert.equal(process.kill(sentinel.pid,0),true);}
} finally {
    try{await runner.dispose();}finally{sentinel?.kill('SIGKILL');await sentinelClosed;}
}
console.log('timeout passed');
`;
