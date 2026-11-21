export const strykerCatalogScript = `
import assert from 'node:assert/strict';
const {TestStatus} = await import(process.argv[7]);
import { writeFile } from 'node:fs/promises';
const { strykerPlugins } = await import(process.argv[1]);
const [engine, configApi, processModel, freshState, restriction] = process.argv.slice(2);
const metadata = "annotations:{},controls:{},definitionLocations:[{kind:'unknown'}]";
const prelude = 'import { createSuite, createTestCase, createSkippedTestCase } from ' + JSON.stringify(engine) + ';';
const body = "scope => { scope.assert.true(true); return scope.assert.collect(); }";
const ordinary = prelude + 'export const testNode = createTestCase({' + metadata +
    ",title:'original',body:" + body + '});';
const other = prelude + 'export const testNode = createSuite({' + metadata +
    ",title:'other',children:[createTestCase({" + metadata + ",title:'existing',body:" + body + '})]});';
await writeFile('package.json', '{"type":"module"}');
await writeFile('case.test.mjs', ordinary);
await writeFile('other.test.mjs', other);
await writeFile('subject.mjs', 'export const value = true;');
await writeFile('overkill.config.mjs', 'import { defineConfig } from ' + JSON.stringify(configApi) + ';' +
    'export const config = defineConfig(' + JSON.stringify({profiles:{microtest:{
        testFamily:'microtest',files:{include:['case.test.mjs','other.test.mjs']},
        execution:{processModel,scheduling:'concurrent'},timeouts:{collectionMilliseconds:30000}
    }}}) + ');');
const runner = strykerPlugins[0].factory({overkill:{
    configPath:'overkill.config.mjs',freshState:freshState === 'true',seed:'42'
}}, {[process.cwd()+'/subject.mjs']:{mutate:true}}, {info(){}});
const options = {activeMutant:{id:'mutant',fileName:'subject.mjs',mutatorName:'BooleanLiteral',replacement:'false',
    location:{start:{line:0,column:0},end:{line:0,column:4}}},mutantActivation:'runtime',
    reloadEnvironment:false,sandboxFileName:process.cwd()+'/subject.mjs',timeout:30000,disableBail:true};
const dryOptions = {coverageAnalysis:'perTest',timeout:30000,disableBail:true,
    ...(restriction === 'listed-files' ? {testFiles:['case.test.mjs','other.test.mjs']} : {})};
if (restriction === 'skips') {
    for (const file of ['case.test.mjs','other.test.mjs']) await writeFile(file,
        prelude + 'export const testNode = createSkippedTestCase({' + metadata +
            ",title:'skipped',reason:'intentional'});");
}
const recollects = processModel === 'supervised-process' || freshState === 'true';
try {
    const dry = await runner.dryRun(dryOptions);
    assert.equal(dry.status,'complete',JSON.stringify(dry));
    assert.equal(dry.tests.length,2);
    if (restriction === 'skips') {
        assert.ok(dry.tests.every(test => test.status === TestStatus.Skipped));
        const result = await runner.mutantRun(options);
        assert.equal(result.status,'error',JSON.stringify(result));
        assert.match(result.errorMessage,/no runnable tests/);
    } else {
    assert.equal((await runner.dryRun(dryOptions)).status,'complete');
    for (const changed of [{...dryOptions,testFiles:['case.test.mjs']},
        {...dryOptions,coverageAnalysis:'off'}]) {
        const result = await runner.dryRun(changed);
        assert.equal(result.status,'error',JSON.stringify(result));
        assert.match(result.errorMessage,/original campaign selection or coverage mode/);
    }
    const added = other.replace('children:[',
        'children:[createTestCase({' + metadata + ",title:'added',body:" + body + '}),');
    await writeFile('other.test.mjs',added);
    const grown = await runner.mutantRun(options);
    assert.equal(grown.status,recollects ? 'error' : 'survived',JSON.stringify(grown));
    if (recollects) assert.match(grown.errorMessage,/catalog changed/);
    const repeated = await runner.dryRun(dryOptions);
    assert.equal(repeated.status,recollects ? 'error' : 'complete',JSON.stringify(repeated));
    if (recollects) assert.match(repeated.errorMessage,/catalog changed/);
    await writeFile('other.test.mjs',other);
    for (const changed of [ordinary.replace("title:'original'","title:'renamed'"),
        ordinary.replace('annotations:{}',"annotations:{tags:['changed']}"),
        ordinary.replace('controls:{}','controls:{timeoutMilliseconds:1}'),
        prelude + 'export const testNode = createSkippedTestCase({' + metadata +
            ",title:'original',reason:'changed'});",
        prelude + 'throw new Error("collection failed");']) {
        await writeFile('case.test.mjs',changed);
        const result = await runner.mutantRun(options);
        assert.equal(result.status,recollects ? 'error' : 'survived',JSON.stringify(result));
        if (recollects) {
            const repeated = await runner.dryRun(dryOptions);
            assert.equal(repeated.status,'error',JSON.stringify(repeated));
        }
    }
    await writeFile('case.test.mjs',ordinary);
    const restored = await runner.mutantRun(options);
    assert.equal(restored.status,'survived',JSON.stringify(restored));
    assert.equal(restored.nrOfTests,2);
    }
} finally { await runner.dispose(); }
console.log('catalog passed');
`;
