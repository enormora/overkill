const terminationProject = `
import assert from 'node:assert/strict';
import { writeFile, readdir } from 'node:fs/promises';
import { channel } from 'node:diagnostics_channel';
const [adapter, engine, configApi, processModel, freshState, operation, phase, invocation, tool] =
    process.argv.slice(1);
const effects = {
    'exit-zero': 'process.exit(0);',
    'exit-nonzero': 'process.exit(7);',
    abort: 'process.abort();',
    signal: 'process.kill(process.pid,"SIGKILL");'
};
assert.ok(Object.hasOwn(effects, operation));
const effect = invocation === 'dry' ? effects[operation] : 'if(!terminates()){' + effects[operation] + '}';
const subject = 'export function terminates(){return true;} export function control(){return true;}';
await writeFile('package.json', '{"type":"module"}');
await writeFile('subject.mjs', subject);
await writeFile('case.test.mjs', 'import {createTestCase} from '+JSON.stringify(engine)+';'+
    'import {terminates,control} from "./subject.mjs";'+
    (phase === 'collection' ? effect+'const expected=control();' : '')+
    'export const testNode=createTestCase({annotations:{},controls:{},'+
    'definitionLocations:[{kind:"unknown"}],title:"termination control",body(scope){'+
    (phase === 'body' ? effect : '')+
    'scope.assert.true('+(phase === 'collection' ? 'expected' : 'control()')+');return scope.assert.collect();}});');
await writeFile('overkill.config.mjs', 'import {defineConfig} from '+JSON.stringify(configApi)+';'+
    'export const config=defineConfig('+JSON.stringify({profiles:{microtest:{testFamily:'microtest',
        files:{include:['case.test.mjs']},execution:{processModel,scheduling:'concurrent'},
        timeouts:{collectionMilliseconds:30000,softMilliseconds:30000,hardMilliseconds:60000}
    }}})+');');
const children = new Set();
const exits = [];
const spawned = channel('child_process');
function observeChild(message) {
    const child = message.process;
    children.add(child);
    child.once('exit', (code, signal) => exits.push({code, signal}));
    child.once('close', () => children.delete(child));
}
spawned.subscribe(observeChild);
async function assertReaped() {
    const closing=Promise.all(Array.from(children, child => new Promise(resolve => child.once('close', resolve))));
    let timer;
    try {
        await Promise.race([closing,new Promise((resolve,reject)=>{
            timer=setTimeout(()=>reject(new Error('Owned termination hosts did not close')),10000);
        })]);
    } finally {
        clearTimeout(timer);
        for(const child of children)child.kill('SIGKILL');
        await closing;
    }
    assert.equal(children.size, 0);
    assert.equal((await readdir('.')).includes('.overkill'), false);
}
`;

export const strykerTerminationScript = `${terminationProject}
const {strykerPlugins} = await import(adapter);
const {Instrumenter} = await import(tool);
const instrumented = await new Instrumenter({info(){},debug(){},isDebugEnabled:()=>false}).instrument([
    {name:process.cwd()+'/subject.mjs',content:subject,mutate:true}
], {excludedMutations:['BlockStatement'],ignorers:[],plugins:null});
await writeFile('subject.mjs',instrumented.files[0].content);
const mutants = instrumented.mutants.filter(mutant => mutant.mutatorName === 'BooleanLiteral');
assert.equal(mutants.length,2);
const runner = strykerPlugins[0].factory({overkill:{configPath:'overkill.config.mjs',
    freshState:freshState === 'true',seed:'42'}},{[process.cwd()+'/subject.mjs']:{mutate:true}},{info(){}});
const dryOptions = {coverageAnalysis:'perTest',timeout:30000,disableBail:true};
const options = {activeMutant:mutants[0],mutantActivation:phase === 'collection' ? 'static' : 'runtime',
    reloadEnvironment:false,sandboxFileName:process.cwd()+'/subject.mjs',timeout:30000,disableBail:true};
try {
    const dry = await runner.dryRun(dryOptions);
    if(invocation === 'dry') {
        assert.equal(dry.status,'error',JSON.stringify(dry));
        assert.match(dry.errorMessage,/result|lifecycle|load|crash/i);
        assert.equal(Object.hasOwn(dry,'mutantCoverage'),false);
        const unavailable = await runner.mutantRun(options);
        assert.equal(unavailable.status,'error',JSON.stringify(unavailable));
        assert.match(unavailable.errorMessage,/baseline is unavailable/);
    } else {
        assert.equal(dry.status,'complete',JSON.stringify(dry));
        exits.length=0;
        const failed = await runner.mutantRun(options);
        assert.equal(failed.status,'error',JSON.stringify(failed));
        assert.match(failed.errorMessage,/result|lifecycle|load|crash/i);
        assert.equal(Object.hasOwn(failed,'killedBy'),false);
        assert.equal(Object.hasOwn(failed,'nrOfTests'),false);
        const expected = operation === 'abort' ? 'SIGABRT' : operation === 'signal' ? 'SIGKILL' : null;
        assert.ok(exits.some(exit => expected === null
            ? exit.code === (operation === 'exit-nonzero' ? 7 : processModel === 'supervised-process' ? 0 : 1) &&
              exit.signal === null
            : exit.signal === expected),JSON.stringify(exits));
        const control = await runner.mutantRun({...options,activeMutant:mutants[1]});
        assert.equal(control.status,'killed',JSON.stringify(control));
        assert.deepEqual(control.killedBy,[dry.tests[0].id]);
        assert.equal(control.nrOfTests,1);
        const repeated = await runner.dryRun(dryOptions);
        assert.equal(repeated.status,'complete',JSON.stringify(repeated));
        assert.deepEqual(repeated.tests.map(test=>test.id),dry.tests.map(test=>test.id));
    }
} finally {
    await runner.dispose();
    await assertReaped();
    spawned.unsubscribe(observeChild);
}
console.log('termination passed');
`;

export const strykerTerminationCampaignScript = `${terminationProject}
const {Stryker} = await import(tool);
const campaign = new Stryker({testRunner:'overkill',plugins:[adapter],mutate:['subject.mjs'],
    files:['package.json','subject.mjs','case.test.mjs','overkill.config.mjs'],testFiles:['case.test.mjs'],
    overkill:{configPath:'overkill.config.mjs',freshState:false,seed:'42'},
    mutator:{excludedMutations:['BlockStatement']},concurrency:1,maxTestRunnerReuse:100,
    reporters:[],logLevel:'off',fileLogLevel:'debug',timeoutMS:30000,dryRunTimeoutMinutes:1,
    coverageAnalysis:'perTest',cleanTempDir:true,tempDirName:'.stryker-tmp'});
try {
    if(invocation === 'dry') {
        await assert.rejects(campaign.runMutationTest(),/dry|test|crash|error/i);
    } else {
        const results = await campaign.runMutationTest();
        const booleans = results.filter(result=>result.mutatorName === 'BooleanLiteral');
        assert.equal(booleans.length,2,JSON.stringify(results));
        assert.deepEqual(booleans.map(result=>result.status),['RuntimeError','Killed'],JSON.stringify(results));
        assert.match(booleans[0].statusReason,/crash|exit|SIGABRT|SIGKILL/i);
        assert.equal(Object.hasOwn(booleans[0],'killedBy'),false);
        assert.equal(booleans[1].testsCompleted,1);
        assert.equal(booleans[1].killedBy.length,1);
    }
} finally {
    await assertReaped();
    spawned.unsubscribe(observeChild);
}
console.log('termination passed');
`;
