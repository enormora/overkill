export const mutationCacheScript = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { withMutationProject, writeMutationProfile } = await import(process.argv[1]);
const [modules, mode] = JSON.parse(process.argv[2]);
await withMutationProject(async () => {
    await writeMutationProfile(modules, mode, process.cwd());
    const { Instrumenter } = await import(modules.instrumenter);
    const quiet = () => {};
    const logger = { trace:quiet, debug:quiet, info:quiet, warn:quiet, error:quiet, fatal:quiet,
        isTraceEnabled:()=>false, isDebugEnabled:()=>false, isInfoEnabled:()=>false,
        isWarnEnabled:()=>false, isErrorEnabled:()=>false, isFatalEnabled:()=>false };
    const instrumented = await new Instrumenter(logger).instrument([
        {name:process.cwd() + '/subject.mjs', content:'export function value() { return true; }', mutate:true}
    ], {excludedMutations:['BlockStatement'], ignorers:[], plugins:null});
    assert.equal(instrumented.files.length, 1);
    await writeFile('subject.mjs', instrumented.files[0].content);
    await writeFile('cache.cjs', 'let cached; exports.read = compute => { cached ??= compute(); return cached; };');
    await writeFile('nested.mjs', 'export {default as cache} from "./cache.cjs";');
    await writeFile('cache.test.mjs',
        'import {createTestCase} from ' + JSON.stringify(modules.engine) + ';' +
        'import {value} from "./subject.mjs"; import {cache} from "./nested.mjs";' +
        'export const testNode = createTestCase({annotations:{},controls:{},definitionLocations:[{kind:"unknown"}],' +
        'title:"cached value",body(scope){scope.assert.equal(cache.read(value),true);return scope.assert.collect();}});');
    const { strykerPlugins } = await import(modules.adapter);
    const runner = strykerPlugins[0].factory({overkill:{configPath:'overkill.config.mjs',seed:'42',freshState:mode.freshState}}, {
        [process.cwd() + '/subject.mjs']:{mutate:true}, [process.cwd() + '/cache.test.mjs']:{mutate:false}
    }, logger);
    try {
        await runner.init();
        const dry = await runner.dryRun({coverageAnalysis:'perTest',timeout:30000,disableBail:true});
        assert.equal(dry.status,'complete',JSON.stringify(dry));
        const mutant = instrumented.mutants.find(value => value.mutatorName === 'BooleanLiteral');
        assert.ok(mutant);
        assert.equal(dry.tests.length,1);
        assert.equal(dry.mutantCoverage.perTest[dry.tests[0].id][mutant.id],1);
        const result = await runner.mutantRun({activeMutant:mutant,mutantActivation:'runtime',reloadEnvironment:false,
            sandboxFileName:process.cwd() + '/subject.mjs',timeout:30000,disableBail:true,testFilter:[dry.tests[0].id]});
        const expected = mode.freshState || mode.processModel === 'supervised-process' ? 'killed' : 'survived';
        assert.equal(result.status,expected,JSON.stringify(result));
        assert.equal(result.nrOfTests,1);
        process.stdout.write(JSON.stringify({status:result.status,testsCompleted:result.nrOfTests}));
    } finally {
        await runner.dispose();
    }
});
`;
