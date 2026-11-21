export const strykerCoverageScript = `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { Instrumenter } = await import(process.argv[1]);
const { strykerPlugins } = await import(process.argv[2]);
const [engine, configApi, processModel, freshState, coverageAnalysis] = process.argv.slice(3);
const logger = { info() {}, debug() {}, isDebugEnabled: () => false };
const instrumented = await new Instrumenter(logger).instrument([
    { name: process.cwd() + '/subject.mjs',
      content: 'export function value() { return true; } ' +
        'export function untouched() { return true; } export const initial = true;', mutate: true }
], { excludedMutations: ['BlockStatement'], ignorers: [], plugins: null });
await writeFile('package.json', '{"type":"module"}');
await writeFile('subject.mjs', instrumented.files[0].content);
await writeFile('case.test.mjs',
    'import { createSuite, createTestCase } from ' + JSON.stringify(engine) + ';' +
    "import { value } from './subject.mjs';" +
    "const metadata = { annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}] };" +
    "export const testNode = createSuite({...metadata, title:'coverage', children:" +
    "['first', 'second', 'unrelated'].map(title => createTestCase({...metadata, title, body(scope) {" +
    "scope.assert.equal(title === 'unrelated' ? true : value(), true); return scope.assert.collect(); }}))});");
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
    const dry = await runner.dryRun({ coverageAnalysis, timeout: 30000, disableBail: true });
    assert.equal(dry.status, 'complete', JSON.stringify(dry));
    assert.equal(dry.tests.length, 3);
    const mutants = instrumented.mutants.filter(mutant => mutant.mutatorName === 'BooleanLiteral');
    assert.equal(mutants.length, 3);
    const [covered, uncovered, initial] = mutants;
    const ids = dry.tests.filter(test => !test.name.endsWith('unrelated')).map(test => test.id);
    if (coverageAnalysis === 'perTest') {
        assert.deepEqual(dry.mutantCoverage.static, { [initial.id]: 1 });
        assert.deepEqual(Object.keys(dry.mutantCoverage.perTest).sort(), ids.toSorted());
        assert.deepEqual(Object.values(dry.mutantCoverage.perTest).map(counts => counts[covered.id]), [1, 1]);
    } else if (coverageAnalysis === 'all') {
        assert.deepEqual(dry.mutantCoverage, { static: { [covered.id]: 2, [initial.id]: 1 }, perTest: {} });
    } else {
        assert.equal(Object.hasOwn(dry, 'mutantCoverage'), false);
    }
    const originalCoverage = structuredClone(dry.mutantCoverage);
    if (dry.mutantCoverage) dry.mutantCoverage.static[initial.id] = 999;
    const repeated = await runner.dryRun({ coverageAnalysis, timeout: 30000, disableBail: true });
    assert.equal(repeated.status, 'complete', JSON.stringify(repeated));
    assert.deepEqual(repeated.mutantCoverage, originalCoverage);
    const options = { activeMutant: covered, mutantActivation: 'runtime', reloadEnvironment: false,
        sandboxFileName: process.cwd() + '/subject.mjs', timeout: 30000, disableBail: true };
    const narrowed = await runner.mutantRun({ ...options, testFilter: ids });
    assert.equal(narrowed.status, 'killed', JSON.stringify(narrowed));
    assert.equal(narrowed.nrOfTests, coverageAnalysis === 'perTest' ? 2 : 3);
    for (const testFilter of [[ids[0]], [dry.tests.find(test => test.name.endsWith('unrelated')).id]]) {
        const fallback = await runner.mutantRun({ ...options, testFilter });
        assert.equal(fallback.status, 'killed', JSON.stringify(fallback));
        assert.equal(fallback.nrOfTests, 3);
        assert.equal(fallback.killedBy.length, 2);
    }
    const uncertain = await runner.mutantRun({ ...options, activeMutant: uncovered, testFilter: [ids[0]] });
    assert.equal(uncertain.status, 'survived', JSON.stringify(uncertain));
    assert.equal(uncertain.nrOfTests, 3);
    for (const testFilter of [[], ['unknown'], [ids[0], ids[0]]]) {
        const invalid = await runner.mutantRun({ ...options, testFilter });
        assert.equal(invalid.status, 'error', JSON.stringify(invalid));
    }
} finally {
    await runner.dispose();
}
console.log('coverage passed');
`;
