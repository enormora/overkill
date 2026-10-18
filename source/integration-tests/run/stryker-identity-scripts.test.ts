export const strykerIdentityScript = `
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { Instrumenter } = await import(process.argv[1]);
const { strykerPlugins } = await import(process.argv[2]);
const [engine, configApi, processModel, freshState] = process.argv.slice(3);
const logger = { info() {}, debug() {}, isDebugEnabled: () => false };
const instrumented = await new Instrumenter(logger).instrument([
    { name: process.cwd() + '/subject.mjs', content: 'export function value() { return true; }', mutate: true }
], { excludedMutations: ['BlockStatement'], ignorers: [], plugins: null });
await writeFile('package.json', '{"type":"module"}');
await writeFile('subject.mjs', instrumented.files[0].content);
await writeFile('case.test.mjs',
    'import { createSuite, createTable, createTestCase, attachTestBodyResourceAttachments } from ' +
    JSON.stringify(engine) + ';' +
    "import { value } from './subject.mjs';" +
    "const metadata = { annotations: {}, controls: {}," +
    "definitionLocations: [{kind:'known',file:'case.test.mjs',line:10,column:2}] };" +
    "const pass = scope => { scope.assert.true(true); return scope.assert.collect(); };" +
    "const check = attachTestBodyResourceAttachments(scope => {" +
    "scope.assert.equal(value(), true); return scope.assert.collect(); }, {" +
    "directResources: [], resourceGraph: [], runtimeGraphs: [{kind:'runtime-matrix',name:'node',resources:[]," +
    "variants: ['first','second'].map(id => ({id, runtime: {name:'node',dimensions:{node:'26'}," +
    "requirements:[],resources:[],scenarioBindings:[]}}))}]});" +
    "export const testNode = createSuite({...metadata, title:'identity', children:[" +
    "createSuite({...metadata,title:'outer > inner',children:[" +
    "createTestCase({...metadata,title:'checks',body:pass})]})," +
    "createSuite({...metadata,title:'outer',children:[createSuite({...metadata,title:'inner',children:[" +
    "createTestCase({...metadata,title:'checks',body:pass})]})]})," +
    "createTable({...metadata,title:'rows',cases:[" +
    "{annotations:{},controls:{},title:'covered',parameters:{value:1},body:check}," +
    "{annotations:{},controls:{},title:'unrelated',parameters:{value:2},body:pass}]})]});");
await writeFile('overkill.config.mjs',
    'import { defineConfig } from ' + JSON.stringify(configApi) + ';' +
    'export const config = defineConfig(' + JSON.stringify({ profiles: { microtest: {
        testFamily: 'microtest', files: { include: ['case.test.mjs'] },
        execution: { processModel, scheduling: 'concurrent' },
        timeouts: { collectionMilliseconds: 30000 }
    } } }) + ');');
const runner = strykerPlugins[0].factory({ overkill: {
    configPath: 'overkill.config.mjs', freshState: freshState === 'true', seed: '42'
} }, {
    [process.cwd() + '/subject.mjs']: { mutate: true },
    [process.cwd() + '/case.test.mjs']: { mutate: false }
}, logger);
try {
    const dry = await runner.dryRun({ coverageAnalysis: 'perTest', timeout: 30000, disableBail: true });
    assert.equal(dry.status, 'complete', JSON.stringify(dry));
    assert.equal(dry.tests.length, 5);
    assert.equal(new Set(dry.tests.map(test => test.id)).size, 5);
    assert.equal(new Set(dry.tests.map(test => test.name)).size, 3);
    assert.ok(dry.tests.every(test => test.fileName === 'case.test.mjs' && !test.id.includes(process.cwd())));
    const covered = dry.tests.filter(test => test.name.includes('covered'));
    const ids = covered.map(test => test.id).toSorted();
    assert.equal(ids.length, 2);
    assert.deepEqual(Object.keys(dry.mutantCoverage.perTest).sort(), ids);
    const mutant = instrumented.mutants.find(mutant => mutant.mutatorName === 'BooleanLiteral');
    assert.ok(mutant);
    for (const id of ids) assert.equal(dry.mutantCoverage.perTest[id][mutant.id], 1);
    const source = await readFile('case.test.mjs', 'utf8');
    await writeFile('case.test.mjs', source.replace('line:10,column:2', 'line:200,column:30'));
    const options = { activeMutant: mutant, mutantActivation: 'runtime', reloadEnvironment: false,
        sandboxFileName: process.cwd() + '/subject.mjs', timeout: 30000, disableBail: true };
    const narrowed = await runner.mutantRun({ ...options, testFilter: ids });
    assert.equal(narrowed.status, 'killed', JSON.stringify(narrowed));
    assert.equal(narrowed.nrOfTests, 2);
    assert.deepEqual(narrowed.killedBy.toSorted(), ids);
    const fallback = await runner.mutantRun({ ...options, testFilter: [ids[0]] });
    assert.equal(fallback.status, 'killed', JSON.stringify(fallback));
    assert.equal(fallback.nrOfTests, 5);
    assert.deepEqual(fallback.killedBy.toSorted(), ids);
    console.log(JSON.stringify(dry.tests.map(test => test.id).toSorted()));
} finally {
    await runner.dispose();
}
`;
