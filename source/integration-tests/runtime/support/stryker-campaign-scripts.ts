export const strykerCampaignScript = `
import assert from 'node:assert/strict';
import { writeFile, readdir } from 'node:fs/promises';
const { Stryker } = await import(process.argv[1]);
const [adapter, engine, configApi, processModel, freshState] = process.argv.slice(2);
await writeFile('package.json', '{"type":"module"}');
const looping = process.argv[9] === 'true';
await writeFile('subject.mjs', looping
    ? 'export const initial = true; export function value() { const done = true; while (!done) {} return true; }'
    : 'export const initial = true; export function value() { return true; }' +
      ' export function untouched() { return true; }');
await writeFile('case.test.mjs',
    'import { createTestCase } from ' + JSON.stringify(engine) + ';' +
    "import { initial, value } from './subject.mjs';" +
    "export const testNode = createTestCase({ annotations: {}, controls: {}," +
    "definitionLocations: [{kind:'unknown'}], title: 'static and runtime', body(scope) {" +
    "scope.assert.equal(process.ppid, " + process.pid + "); scope.assert.equal(initial, true);" +
    "scope.assert.equal(value(), true); return scope.assert.collect(); } });");
await writeFile('overkill.config.mjs',
    'import { defineConfig } from ' + JSON.stringify(configApi) + ';' +
    'export const config = defineConfig(' + JSON.stringify({ profiles: { microtest: {
        testFamily: 'microtest', files: { include: ['case.test.mjs'] },
        execution: { processModel, scheduling: 'concurrent' },
        timeouts: { collectionMilliseconds: 30000, softMilliseconds: 30000, hardMilliseconds: 60000 }
    } } }) + ');');
const results = await new Stryker({
    testRunner: 'overkill', plugins: [adapter], mutate: ['subject.mjs'], testFiles: ['case.test.mjs'],
    files: ['package.json', 'subject.mjs', 'case.test.mjs', 'overkill.config.mjs'],
    overkill: { configPath: 'overkill.config.mjs', freshState: freshState === 'true', seed: '42' },
    mutator: { excludedMutations: ['BlockStatement'] },
    concurrency: 2, maxTestRunnerReuse: Number(process.argv[7] ?? '1'), reporters: [],
    logLevel: 'off', fileLogLevel: 'debug',
    timeoutMS: looping ? 5000 : 30000, dryRunTimeoutMinutes: 2, coverageAnalysis: process.argv[8] ?? 'perTest',
    cleanTempDir: true, tempDirName: '.stryker-tmp'
}).runMutationTest();
const booleans = results.filter(result => result.mutatorName === 'BooleanLiteral');
assert.equal(booleans.length, looping ? 4 : 3, JSON.stringify(results));
if (looping) {
    assert.equal(booleans.filter(result => result.status === 'Killed').length, 2, JSON.stringify(results));
    assert.equal(booleans.filter(result => result.status === 'Timeout').length, 2, JSON.stringify(results));
} else {
    assert.deepEqual(booleans.map(result => result.status).sort(),
        ['Killed', 'Killed', (process.argv[8] ?? 'perTest') === 'off' ? 'Survived' : 'NoCoverage'],
        JSON.stringify(results));
}
if ((process.argv[8] ?? 'perTest') === 'perTest') {
    assert.equal(booleans.filter(result => result.static === true).length, 1);
}
assert.equal((await readdir('.')).includes('.overkill'), false);
process.report.excludeEnv = true;
process.report.excludeNetwork = true;
const { setTimeout } = await import('node:timers/promises');
const remainingChildren = () => process.report.getReport().libuv
    .filter(handle => handle.type === 'process' && handle.pid > 0);
const cleanupDeadline = Date.now() + 5000;
while (remainingChildren().length > 0 && Date.now() < cleanupDeadline) await setTimeout(20);
assert.deepEqual(remainingChildren(), []);
console.log('campaign passed');
`;

export const strykerHitLimitScript = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { Instrumenter } = await import(process.argv[1]);
const { strykerPlugins } = await import(process.argv[2]);
const logger = { info() {}, debug() {}, trace() {}, warn() {}, error() {}, fatal() {}, isDebugEnabled: () => false };
const instrumented = await new Instrumenter(logger).instrument([
    { name: process.cwd() + '/subject.mjs', content: 'export function value() { return true; }', mutate: true }
], { excludedMutations: ['BlockStatement'], ignorers: [], plugins: null });
await writeFile('subject.mjs', instrumented.files[0].content);
await writeFile('package.json', '{"type":"module"}');
await writeFile('case.test.mjs',
    'import { createTestCase } from ' + JSON.stringify(process.argv[3]) + ';' +
    "import { value } from './subject.mjs';" +
    "export const testNode = createTestCase({ annotations: {}, controls: {}," +
    "definitionLocations: [{kind:'unknown'}], title: 'swallowed hit limit', body(scope) {" +
    "try { value(); } catch {} scope.cleanup(async () => { await Promise.resolve(); try { value(); } catch {} });" +
    "scope.assert.equal(1, 1); return scope.assert.collect(); } });");
await writeFile('overkill.config.mjs',
    'import {defineConfig} from ' + JSON.stringify(process.argv[4]) + ';' +
    'export const config = defineConfig({profiles: {microtest: {' +
    "testFamily: 'microtest', files: {include: ['case.test.mjs']}," +
    "execution: {processModel: 'in-process', scheduling: 'concurrent'}," +
    'timeouts: {collectionMilliseconds: 30000}}}});');
const runner = strykerPlugins[0].factory({ overkill: {
    configPath: 'overkill.config.mjs', paths: ['case.test.mjs'], seed: '42'
} }, {
    [process.cwd() + '/case.test.mjs']: { mutate: false },
    [process.cwd() + '/subject.mjs']: { mutate: true }
}, logger);
try {
    const dry = await runner.dryRun({ coverageAnalysis: 'all', timeout: 30000, disableBail: false });
    assert.equal(dry.status, 'complete', JSON.stringify(dry));
    const mutant = instrumented.mutants.find(mutant => mutant.mutatorName === 'BooleanLiteral');
    assert.ok(mutant);
    assert.deepEqual(dry.mutantCoverage, { static: { [mutant.id]: 2 }, perTest: {} });
    const runtime = globalThis.__stryker__;
    const coverage = runtime.mutantCoverage;
    const staticCounters = coverage.static;
    const perTestCounters = coverage.perTest;
    const drySnapshot = structuredClone(dry.mutantCoverage);
    function assertInactive() {
        assert.equal(globalThis.__stryker__, runtime);
        assert.equal(runtime.mutantCoverage, coverage);
        assert.equal(coverage.static, staticCounters);
        assert.equal(coverage.perTest, perTestCounters);
        for (const key of ['activeMutant', 'currentTestId', 'hitCount', 'hitLimit']) {
            assert.equal(runtime[key], undefined, key);
        }
        assert.equal(process.env.__STRYKER_ACTIVE_MUTANT__, undefined);
    }
    assertInactive();
    const options = { activeMutant: mutant, mutantActivation: 'runtime', reloadEnvironment: false,
        sandboxFileName: process.cwd() + '/subject.mjs', timeout: 30000, disableBail: false };
    const swallowed = await runner.mutantRun({ ...options, hitLimit: 0 });
    assert.equal(swallowed.status, 'timeout', JSON.stringify(swallowed));
    assertInactive();
    const subsequent = await runner.mutantRun(options);
    assert.equal(subsequent.status, 'survived', JSON.stringify(subsequent));
    assert.equal(subsequent.nrOfTests, 1);
    assertInactive();
    const repeated = await runner.dryRun({ coverageAnalysis: 'all', timeout: 30000, disableBail: false });
    assert.equal(repeated.status, 'complete', JSON.stringify(repeated));
    assert.deepEqual(repeated.mutantCoverage, drySnapshot);
    assert.deepEqual(dry.mutantCoverage, drySnapshot);
    assertInactive();
    const empty = await runner.mutantRun({ ...options, testFilter: [] });
    assert.equal(empty.status, 'error', JSON.stringify(empty));
    const fresh = strykerPlugins[0].factory({ overkill: {
        configPath: 'overkill.config.mjs', paths: ['case.test.mjs'], seed: '42', freshState: true
    } }, {[process.cwd() + '/case.test.mjs']: {mutate: false}}, logger);
    try {
        await fresh.init();
        const baseline = await fresh.dryRun({coverageAnalysis: 'all', timeout: 30000, disableBail: false});
        assert.equal(baseline.status, 'complete', JSON.stringify(baseline));
        await writeFile('case.test.mjs', 'while (true) {}');
        const interrupted = fresh.dryRun({coverageAnalysis: 'all', timeout: 30000, disableBail: false});
        const {setTimeout} = await import('node:timers/promises');
        await setTimeout(200);
        process.report.excludeEnv = true;
        process.report.excludeNetwork = true;
        const children = () => process.report.getReport().libuv
            .filter(handle => handle.type === 'process' && handle.pid > 0);
        assert.ok(children().length > 0);
        const started = performance.now();
        await fresh.dispose();
        assert.ok(performance.now() - started < 5000);
        assert.deepEqual(children(), []);
        assert.equal((await interrupted).status, 'error');
    } finally {
        await fresh.dispose();
    }
} finally {
    await runner.dispose();
}
console.log('hit limit passed');
`;
