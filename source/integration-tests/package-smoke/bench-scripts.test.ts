export const benchAuthoringScript = `
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as bench from '@overkill-dev/bench';
import * as ordinary from '@overkill-dev/test';
import * as standard from '@overkill-dev/test/bench';
import { createRoot, createTestPlan, execute } from '@overkill-dev/engine';

const benchManifest = new URL('../../package.json', import.meta.resolve('@overkill-dev/bench'));
const manifest = JSON.parse(readFileSync(benchManifest, 'utf8'));
assert.deepEqual(Object.keys(bench).sort(), [
    'defineMacro', 'defineParameterizedTestBody', 'skippedTest', 'suite', 'table', 'test'
]);
assert.deepEqual(Object.keys(standard).sort(), Object.keys(bench).sort());
assert.deepEqual(manifest.exports['.'], {
    import: './packages/bench/bench.entry-point.js',
    types: './packages/bench/bench.entry-point.d.ts'
});
assert.deepEqual(readdirSync(new URL('node_modules/@overkill-dev/', benchManifest)).sort(), [
    'engine', 'resources', 'run', 'simulation'
]);
assert.equal(Object.hasOwn(manifest, 'bin'), false);
assert.equal(Object.hasOwn(manifest.dependencies ?? {}, '@overkill-dev/test'), false);
const standardManifest = new URL('../../package.json', import.meta.resolve('@overkill-dev/test'));
const standardPackage = JSON.parse(readFileSync(standardManifest, 'utf8'));
const bundledBenchManifest = new URL('node_modules/@overkill-dev/bench/package.json', standardManifest);
const bundledBench = JSON.parse(readFileSync(bundledBenchManifest, 'utf8'));
assert.equal(bundledBench.name, '@overkill-dev/bench');
assert.equal(bundledBench.version, manifest.version);
assert.equal(bundledBench.version, standardPackage.version);

let calls = 0;
const rowBody = standard.defineParameterizedTestBody((scope, value) => {
    calls += 1;
    scope.assert.equal(value, 3);
    return scope.assert.collect();
});
const node = ordinary.suite('mixed', [
    standard.test({ title: 'parameterized', body: rowBody(3), annotations: { tags: ['bench'] } }),
    bench.suite('ordinary child', [ ordinary.test('fails', (scope) => {
        scope.assert.equal('actual', 'expected');
        return scope.assert.collect();
    }) ]),
    standard.table({ title: 'rows', cases: [2, 4], test(scope) {
        scope.assert.greaterThan(scope.parameters, 0);
        return scope.assert.collect();
    } }),
    bench.skippedTest('skips', 'unavailable')
]);
assert.equal(calls, 0);
const plan = createTestPlan(createRoot({ annotations: {}, children: [node], controls: {}, title: 'root' }));
assert.equal(plan.defined, 6);
assert.equal(plan.discoveredCases.length, 5);
assert.deepEqual(plan.orphans, []);
assert.equal(plan.discoveredCases[0].testFamily, null);
assert.deepEqual(plan.discoveredCases[0].annotations.tags, ['bench']);
const result = await execute(plan);
assert.equal(calls, 1);
assert.equal(result.summary.passed, 3);
assert.equal(result.summary.failed, 1);
assert.equal(result.summary.skipped, 1);
assert.equal(result.summary.defined, 6);
assert.deepEqual(result.runnerErrors, []);
console.log('bench authoring passed');
`;

export const benchMacroScript = `
import assert from 'node:assert/strict';
import * as bench from '@overkill-dev/bench';
import * as ordinary from '@overkill-dev/test';
import * as standard from '@overkill-dev/test/bench';
import {
    captureSourceLocation, createRoot, createTestPlan, execute, resolveSourceLocation
} from '@overkill-dev/engine';

function failingBody(scope) {
    scope.assert.equal('actual', 'expected');
    return scope.assert.collect();
}
async function checkLocations(author, other) {
    const inner = author.defineMacro(() => other.test('fails', failingBody));
    const outer = other.defineMacro(() => author.suite('nested', [inner()]));
    const callSite = captureSourceLocation();
    const node = outer();
    const expected = resolveSourceLocation(callSite);
    const plan = createTestPlan(createRoot({ annotations: {}, children: [node], controls: {}, title: 'root' }));
    const definition = resolveSourceLocation(plan.discoveredCases[0].definitionLocations[0]);
    assert.equal(plan.discoveredCases[0].definitionLocations.length, 3);
    assert.equal(definition.file, expected.file);
    assert.equal(definition.line, expected.line + 1);
    const result = await execute(plan);
    const outcome = result.perTest[0].outcome;
    assert.equal(outcome.kind, 'fail');
    const failure = outcome.failures[0];
    assert.equal(failure.kind, 'assertion');
    assert.equal(failure.checks[0].sourceLocations[0].file, definition.file);
    assert.equal(failure.checks[0].sourceLocations[0].line, definition.line);
}
for (const author of [bench, ordinary, standard]) {
    for (const other of [bench, ordinary, standard]) {
        if (author === other) continue;
        await checkLocations(author, other);
        const broken = author.defineMacro(() => { throw new Error('factory failed'); });
        assert.throws(() => broken(), { message: 'factory failed' });
        assert.equal(other.test('outside macro', failingBody).definitionLocations.length, 1);
        const later = other.defineMacro(() => author.test('later', failingBody));
        assert.equal(later().definitionLocations.length, 2);
    }
}
console.log('bench macro locations passed');
`;

export const standardBenchConsumerConfigScript = `
import { defineConfig } from '@overkill-dev/test/config';

export const config = defineConfig({
    profiles: {
        microtest: {
            testFamily: 'microtest',
            execution: { processModel: 'in-process', scheduling: 'serial' }
        }
    }
});
`;

export const standardBenchConsumerScript = `
import assert from 'node:assert/strict';
import { suite, test } from '@overkill-dev/test';
import * as bench from '@overkill-dev/test/bench';

assert.deepEqual(Object.keys(bench).sort(), [
    'defineMacro', 'defineParameterizedTestBody', 'skippedTest', 'suite', 'table', 'test'
]);
let calls = 0;
const body = bench.defineParameterizedTestBody((scope, value) => {
    calls += 1;
    scope.assert.equal(calls, 1);
    scope.assert.equal(value, 3);
    return scope.assert.collect();
});
const createCase = bench.defineMacro((value) => bench.test('parameterized', body(value)));
const benchmarkSuite = bench.suite('bench authoring', [
    createCase(3),
    bench.table({ title: 'rows', cases: [2, 4], test(scope) {
        scope.assert.greaterThan(scope.parameters, 0);
        return scope.assert.collect();
    } }),
    bench.skippedTest('skips', 'unavailable')
]);
assert.equal(calls, 0);
export const testNode = suite('standard distribution', [
    benchmarkSuite,
    test('composes with ordinary authoring', (scope) => {
        scope.assert.equal(benchmarkSuite.children.length, 3);
        return scope.assert.collect();
    })
]);
`;
