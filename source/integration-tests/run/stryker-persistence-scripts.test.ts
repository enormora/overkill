export const strykerPersistenceScript = `
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
const [adapter, engine, configApi, instrumenter, processModel, freshState, persistence] = process.argv.slice(1);
const {strykerPlugins} = await import(adapter);
const originalRoot = process.cwd();
const sandbox = path.join(originalRoot,'sandbox');
await mkdir(sandbox);
process.chdir(sandbox);
const {Instrumenter} = await import(instrumenter);
const instrumented = await new Instrumenter({info(){},debug(){},isDebugEnabled:()=>false}).instrument([
    {name:path.join(sandbox,'subject.mjs'),content:'export function value() { return true; }',mutate:true}
],{excludedMutations:['BlockStatement'],ignorers:[],plugins:null});
const mutant=instrumented.mutants.find(mutant=>mutant.mutatorName==='BooleanLiteral');
assert.ok(mutant);
await writeFile('package.json','{"type":"module"}');
await writeFile('subject.mjs',instrumented.files[0].content);
const failedDry=persistence.endsWith('-dry');
const blocked=persistence.startsWith('blocked');
const timeout=persistence.endsWith('timeout');
const forbiddenOutput=persistence==='forbidden-output';
const effect=timeout
    ? "if(!value()){if(++mutatedCases===1){scope.assert.true(false);}else{while(true){}}}"
    : forbiddenOutput ? "if(!value()){console.log('forbidden output');}" :
        "scope.assert.true("+(failedDry?'false':'value()')+");";
const titles=timeout?['first admitted case','second admitted case']:['native diagnostic'];
const cases=titles.map(title=>"createTestCase({...metadata,title:"+JSON.stringify(title)+
    ",body(scope){"+effect+"scope.assert.true(true);return scope.assert.collect();}})").join(',');
await writeFile('case.test.mjs','import {createSuite,createTestCase} from '+JSON.stringify(engine)+';'+
    "import {value} from './subject.mjs';let mutatedCases=0;"+
    "const metadata={annotations:{},controls:{},definitionLocations:[{kind:'unknown'}]};"+
    "export const testNode=createSuite({...metadata,title:'diagnostics',children:["+cases+"]});");
await writeFile('overkill.config.mjs','import {defineConfig} from '+JSON.stringify(configApi)+';'+
    'export const config=defineConfig('+JSON.stringify({runtimeStateDir:'custom-state',profiles:{microtest:{
        testFamily:'microtest',
        files:{include:['case.test.mjs']},execution:{processModel,scheduling:'concurrent'},
        timeouts:{collectionMilliseconds:30000,softMilliseconds:timeout?1000:30000,hardMilliseconds:timeout?1500:60000}
    }}})+');');
if(blocked){await writeFile(path.join(originalRoot,'custom-state'),'blocked');}
const runners=[];
function runner() {
    const instance=strykerPlugins[0].factory({overkill:{configPath:'overkill.config.mjs',
        freshState:freshState==='true',seed:'42',
        artifactPersistence:blocked||failedDry||timeout||forbiddenOutput?'failures':persistence}},
        {[path.join(originalRoot,'subject.mjs')]:{mutate:true}},{info(){}});
    runners.push(instance);
    return instance;
}
    const input={activeMutant:mutant,mutantActivation:'runtime',reloadEnvironment:false,
        sandboxFileName:path.join(sandbox,'subject.mjs'),timeout:30000,disableBail:timeout};
try {
    const first=runner();
    const dry=await first.dryRun({coverageAnalysis:'off',timeout:30000,disableBail:false});
    if(failedDry) {
        if(blocked) {
            assert.equal(dry.status,'error',JSON.stringify(dry));
            assert.match(dry.errorMessage,/Mutation diagnostic persistence failed/);
            const withoutBaseline=await first.mutantRun(input);
            assert.equal(withoutBaseline.status,'error',JSON.stringify(withoutBaseline));
            assert.match(withoutBaseline.errorMessage,/Campaign dry-run baseline is unavailable/);
        } else {
            assert.equal(dry.status,'complete',JSON.stringify(dry));
            const campaigns=await readdir(path.join(originalRoot,'custom-state','mutation'));
            const campaignDirectory=path.join(originalRoot,'custom-state','mutation',campaigns[0]);
            const invocations=await readdir(campaignDirectory);
            assert.equal(invocations.length,1);
            const file=path.join(campaignDirectory,invocations[0],'diagnostics.json');
            const document=JSON.parse(await readFile(file,'utf8'));
            assert.equal(document.execution.kind,'dry');
            assert.equal(document.diagnostics.perTest[0].outcome.kind,'fail');
        }
    } else {
    assert.equal(dry.status,'complete',JSON.stringify(dry));

    const killed=await first.mutantRun(input);
    if(blocked) {
        assert.equal(killed.status,'error',JSON.stringify(killed));
        assert.match(killed.errorMessage,/Mutation diagnostic persistence failed/);
        assert.match(killed.errorMessage,/assertion/);
    } else {
        const expected=timeout?'timeout':'killed';
        assert.equal(killed.status,expected,JSON.stringify(killed));
        const replacement=runner();
        const repeated=await replacement.mutantRun(input);
        assert.equal(repeated.status,expected,JSON.stringify(repeated));
        const state=path.join(originalRoot,'custom-state');
        if(persistence==='off') {
            await assert.rejects(readdir(state),{code:'ENOENT'});
        } else {
            const campaigns=await readdir(path.join(state,'mutation'));
            assert.equal(campaigns.length,1);
            const campaignDirectory=path.join(state,'mutation',campaigns[0]);
            const invocations=await readdir(campaignDirectory);
            assert.equal(invocations.length,2);
            for(const invocation of invocations) {
                const documentPath=path.join(campaignDirectory,invocation,'diagnostics.json');
                const document=JSON.parse(await readFile(documentPath,'utf8'));
                assert.equal(document.campaign,campaigns[0]);
                assert.equal(document.invocation,invocation);
                assert.equal(document.execution.mutant,mutant.id);
                assert.deepEqual(document.diagnostics.artifacts,[]);
                if(forbiddenOutput) {
                    assert.ok(document.diagnostics.runnerErrors.some(error=>error.subtype==='runtime-policy'));
                } else {
                    assert.equal(document.diagnostics.perTest[0].id.file,'case.test.mjs');
                    assert.equal(document.diagnostics.perTest[0].outcome.kind,'fail');
                    assert.match(JSON.stringify(document),/assertion/);
                }
            }
            assert.deepEqual(await readdir(state),['mutation']);
            const expectedFiles=['case.test.mjs','overkill.config.mjs','package.json','subject.mjs'];
            assert.deepEqual((await readdir(sandbox)).toSorted(),expectedFiles);
        }
    }
    }
} finally {for(const instance of runners){await instance.dispose();}}
process.chdir(originalRoot);
await rm(sandbox,{recursive:true,force:true});
console.log('persistence passed');
`;
