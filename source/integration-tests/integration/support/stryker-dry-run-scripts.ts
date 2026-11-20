export const strykerDryRunScript = `
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
const [adapter, engine, configApi, processModel, freshState, scenario, campaign] = process.argv.slice(1);
const {strykerPlugins} = await import(adapter);
const {TestStatus} = await import(process.argv[8]);
const metadata = "annotations:{},controls:{},definitionLocations:[{kind:'unknown'}]";
const prelude = 'import {createSuite,createTestCase,createSkippedTestCase} from ' + JSON.stringify(engine) + ';';
const passing = "scope => {scope.assert.true(true);return scope.assert.collect();}";
const failing = "scope => {scope.assert.true(false);return scope.assert.collect();}";
const cleanup = "scope => {scope.cleanup(() => {throw new Error('cleanup sentinel');});" +
    "scope.assert.true(false);return scope.assert.collect();}";
const timeout = "async scope => {await new Promise(resolve => " +
    "scope.signal.addEventListener('abort',resolve,{once:true}));" +
    "scope.assert.true(true);return scope.assert.collect();}";
const cases = scenario === 'mixed'
    ? ["createTestCase({"+metadata+",title:'passes',body:"+passing+"})",
       "createTestCase({"+metadata+",title:'fails',body:"+failing+"})",
       "createSkippedTestCase({"+metadata+",title:'skips',reason:'intentional'})",
       "createTestCase({"+metadata+",title:'after failure',body:"+passing+"})"]
    : ["createTestCase({"+metadata+",title:'affected case',body:"+
       (scenario === 'cleanup' ? cleanup : timeout)+"})"];
await writeFile('package.json','{"type":"module"}');
await writeFile('subject.mjs','export const value = true;');
await writeFile('case.test.mjs',prelude+'export const testNode=createSuite({'+metadata+
    ",title:'dry suite',children:["+cases.join(',')+']});');
await writeFile('overkill.config.mjs','import {defineConfig} from '+JSON.stringify(configApi)+';'+
    'export const config=defineConfig('+JSON.stringify({profiles:{microtest:{testFamily:'microtest',
        files:{include:['case.test.mjs']},execution:{processModel,scheduling:'concurrent'},
        timeouts:{collectionMilliseconds:30000,softMilliseconds:scenario === 'timeout' ? 10 : 30000,
            hardMilliseconds:60000}}}})+');');
if (campaign !== 'none') {
    const {Stryker} = await import(campaign);
    await assert.rejects(new Stryker({testRunner:'overkill',plugins:[adapter],
        mutate:['subject.mjs'],testFiles:['case.test.mjs'],
        files:['package.json','subject.mjs','case.test.mjs','overkill.config.mjs'],
        overkill:{configPath:'overkill.config.mjs',freshState:freshState === 'true',seed:'42'},
        concurrency:1,reporters:['json'],jsonReporter:{fileName:'mutation-score.json'},logLevel:'off',
        coverageAnalysis:'off',dryRunTimeoutMinutes:1,cleanTempDir:true,tempDirName:'.stryker-tmp'
    }).runMutationTest(),/Something went wrong in the initial test run/);
    await assert.rejects(access('mutation-score.json'),{code:'ENOENT'});
} else {
    const runner = strykerPlugins[0].factory({overkill:{configPath:'overkill.config.mjs',
        freshState:freshState === 'true',seed:'42'}},
        {[process.cwd()+'/subject.mjs']:{mutate:true}},{info(){}});
    try {
        const result = await runner.dryRun({coverageAnalysis:'off',timeout:30000,disableBail:false});
        if (scenario === 'mixed') {
            assert.equal(result.status,'complete',JSON.stringify(result));
            assert.equal(result.tests.length,4);
            const statuses = Object.fromEntries(result.tests.map(test => [test.name,test.status]));
            assert.deepEqual(statuses,{'dry suite > passes':TestStatus.Success,'dry suite > fails':TestStatus.Failed,
                'dry suite > skips':TestStatus.Skipped,'dry suite > after failure':TestStatus.Success});
            for (const test of result.tests) {
                assert.equal(test.id,JSON.stringify(['case.test.mjs',['dry suite'],
                    test.name.slice('dry suite > '.length),null]));
                assert.equal(test.fileName,'case.test.mjs');
                assert.equal(Number.isFinite(test.timeSpentMs),true);
                assert.ok(test.timeSpentMs >= 0);
            }
            assert.match(result.tests.find(test => test.status === TestStatus.Failed).failureMessage,/assertion/);
        } else {
            assert.equal(result.status,scenario === 'cleanup' ? 'error' : 'timeout',JSON.stringify(result));
            assert.equal(Object.hasOwn(result,'tests'),false);
            assert.equal(Object.hasOwn(result,'mutantCoverage'),false);
            if (scenario === 'cleanup') {
                assert.match(result.errorMessage,/cleanup sentinel/);
                assert.match(result.errorMessage,/assertion/);
                assert.ok(result.errorMessage.includes('["case.test.mjs",["dry suite"],"affected case",null]'));
            }
            const mutant = await runner.mutantRun({activeMutant:{id:'0',fileName:'subject.mjs',
                mutatorName:'BooleanLiteral',replacement:'false',
                location:{start:{line:0,column:0},end:{line:0,column:4}}},mutantActivation:'runtime',
                reloadEnvironment:false,sandboxFileName:process.cwd()+'/subject.mjs',
                timeout:30000,disableBail:true});
            assert.equal(mutant.status,'error',JSON.stringify(mutant));
            assert.match(mutant.errorMessage,/baseline is unavailable/);
        }
    } finally {await runner.dispose();}
}
console.log('dry run passed');
`;
