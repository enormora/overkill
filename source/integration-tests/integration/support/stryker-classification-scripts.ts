export const strykerClassificationScript = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const [adapter, engine, configApi, instrumenter, processModel, freshState, scenario, api] = process.argv.slice(1);
const {strykerPlugins} = await import(adapter);
const {TestStatus} = await import(api);
const {Instrumenter} = await import(instrumenter);
const instrumented = await new Instrumenter({info(){},debug(){},isDebugEnabled:()=>false}).instrument([
    {name:process.cwd()+'/subject.mjs',content:'export function value() { return true; }',mutate:true}
],{excludedMutations:['BlockStatement'],ignorers:[],plugins:null});
const mutant = instrumented.mutants.find(mutant => mutant.mutatorName === 'BooleanLiteral');
assert.ok(mutant);
await writeFile('package.json','{"type":"module"}');
await writeFile('subject.mjs',instrumented.files[0].content);
const caseTimeoutMilliseconds = 1000;
const cleanupDelay = "const deadline=performance.now()+"+(caseTimeoutMilliseconds*2)+
    ";while(performance.now()<deadline){}";
const continued = scenario.startsWith('continued-');
const cleanupError = scenario.includes('cleanup-error');
const timedOut = scenario.endsWith('timeout');
const delayedCleanup = "scope.cleanup(()=>{"+cleanupDelay+
    (cleanupError ? "throw new Error('cleanup sentinel');" : '')+"});";
const effects = {
    assertion:"scope.assert.true(value());",
    body:"if(!value())throw new Error('body sentinel');",
    contract:"if(!value())scope.plan(2);",
    leak:"if(!value())pendingPromises.push(new Promise(()=>{}));",
    console:"if(!value())console.log('console sentinel');",
    permission:"if(!value())throw Object.assign(new Error('permission sentinel'),"+
        "{code:'ERR_ACCESS_DENIED',permission:'FileSystemWrite',resource:'/denied'});",
    rejection:"if(!value()){Promise.reject(new Error('rejection sentinel'));"+
        "await new Promise(resolve=>setImmediate(resolve));}",
    exception:"if(!value()){queueMicrotask(()=>{throw new Error('exception sentinel');});"+
        "await new Promise(resolve=>setImmediate(resolve));}",
    cleanup:"if(!value())scope.cleanup(()=>{throw new Error('cleanup sentinel');});",
    'cleanup-policy':"if(!value())scope.cleanup(()=>{console.log('cleanup policy sentinel');});",
    'pre-case':"",
    'kill-cleanup-timeout':"scope.assert.true(value());if(!value())"+delayedCleanup,
    'kill-cleanup-error-timeout':"scope.assert.true(value());if(!value())"+delayedCleanup,
    'continued-timeout':"if(!value()){if(++mutatedCases===1){scope.assert.true(value());}else{"+delayedCleanup+"}}",
    'continued-cleanup-error-timeout':"if(!value()){if(++mutatedCases===1){scope.assert.true(value());}else{"+
        delayedCleanup+"}}"
};
const before = scenario === 'pre-case' ? "if(!value())throw new Error('pre-case sentinel');" : '';
const effect = effects[scenario];
assert.notEqual(effect,undefined);
const controls = JSON.stringify(timedOut ? {timeoutMilliseconds:caseTimeoutMilliseconds} : {});
const cases = (continued ? ['first case','second case'] : ['affected case']).map(title =>
    "createTestCase({...metadata,title:"+JSON.stringify(title)+",async body(scope){"+
    effect+"scope.assert.true(true);return scope.assert.collect();}})").join(',');
await writeFile('case.test.mjs','import {createSuite,createTestCase} from '+JSON.stringify(engine)+';'+
    "import {value} from './subject.mjs';"+before+
    "const pendingPromises=[];let mutatedCases=0;const metadata={annotations:{},controls:"+controls+
    ",definitionLocations:[{kind:'unknown'}]};"+
    "export const testNode=createSuite({...metadata,title:'classification',children:["+cases+"]});");
await writeFile('overkill.config.mjs','import {defineConfig} from '+JSON.stringify(configApi)+';'+
    'export const config=defineConfig('+JSON.stringify({profiles:{microtest:{testFamily:'microtest',
        files:{include:['case.test.mjs']},execution:{processModel,scheduling:'concurrent'},
        timeouts:{collectionMilliseconds:30000,softMilliseconds:30000,hardMilliseconds:60000}
    }}})+');');
const runner = strykerPlugins[0].factory({overkill:{configPath:'overkill.config.mjs',
    freshState:freshState === 'true',seed:'42'}},
    {[process.cwd()+'/subject.mjs']:{mutate:true}},{info(){}});
try {
    const dry = await runner.dryRun({coverageAnalysis:'off',timeout:30000,disableBail:false});
    assert.equal(dry.status,'complete',JSON.stringify(dry));
    assert.equal(dry.tests[0].status,TestStatus.Success,JSON.stringify(dry));
    const options = {activeMutant:mutant,mutantActivation:scenario === 'pre-case' ? 'static' : 'runtime',
        reloadEnvironment:false,sandboxFileName:process.cwd()+'/subject.mjs',timeout:30000,disableBail:continued};
    const result = await runner.mutantRun(options);
    const error = scenario === 'cleanup' || scenario === 'pre-case' || cleanupError;
    assert.equal(result.status,error ? 'error' : timedOut ? 'timeout' : 'killed',JSON.stringify(result));
    if(timedOut){
        const message=error ? result.errorMessage : result.reason;
        for(const test of dry.tests){assert.ok(message.includes(test.id),JSON.stringify(result));}
        assert.match(message,/assertion/);
        assert.match(message,/timeout/);
        if(error){assert.match(message,/cleanup sentinel/);}
    }
    if(error){
        if(scenario === 'pre-case'){
            const message = processModel === 'supervised-process'
                ? 'Eligible test catalog changed under mutation.\\nFailed to load test module: case.test.mjs'
                : 'Failed to load test module: case.test.mjs';
            assert.equal(result.errorMessage,message);
        } else {assert.match(result.errorMessage,/cleanup sentinel/);}
    } else if(!timedOut) {
        assert.deepEqual(result.killedBy,[dry.tests[0].id]);
        assert.equal(result.nrOfTests,1);
        assert.ok(result.failureMessage.includes(dry.tests[0].id));
        const diagnostic = scenario === 'leak' ? /async-leak/ : scenario === 'console' || scenario === 'cleanup-policy'
            ? /console/
            : /assertion|sentinel|plan-mismatch/;
        assert.match(result.failureMessage,diagnostic);
    }
} finally {await runner.dispose();}
console.log('classification passed');
`;
