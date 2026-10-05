export const benchAuthoringScript = `
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as bench from '@overkill-dev/bench';
import * as ordinary from '@overkill-dev/test';
import { createRoot, createTestPlan, execute } from '@overkill-dev/engine';

const benchManifest = new URL('../../package.json', import.meta.resolve('@overkill-dev/bench'));
const manifest = JSON.parse(readFileSync(benchManifest, 'utf8'));
assert.deepEqual(Object.keys(bench).sort(), [
    'defineMacro', 'defineParameterizedTestBody', 'skippedTest', 'suite', 'table', 'test'
]);
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
assert.equal(readdirSync(new URL('node_modules/@overkill-dev/', standardManifest)).includes('bench'), false);

let calls = 0;
const rowBody = bench.defineParameterizedTestBody((scope, value) => {
    calls += 1;
    scope.assert.equal(value, 3);
    return scope.assert.collect();
});
const node = ordinary.suite('mixed', [
    bench.test({ title: 'parameterized', body: rowBody(3), annotations: { tags: ['bench'] } }),
    bench.suite('ordinary child', [ ordinary.test('fails', (scope) => {
        scope.assert.equal('actual', 'expected');
        return scope.assert.collect();
    }) ]),
    bench.table({ title: 'rows', cases: [2, 4], test(scope) {
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
import {
    captureSourceLocation, createRoot, createTestPlan, execute, resolveSourceLocation
} from '@overkill-dev/engine';

assert.notEqual(bench.defineMacro, ordinary.defineMacro);
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
await checkLocations(bench, ordinary);
await checkLocations(ordinary, bench);
const broken = bench.defineMacro(() => { throw new Error('factory failed'); });
assert.throws(() => broken(), { message: 'factory failed' });
assert.equal(ordinary.test('outside macro', failingBody).definitionLocations.length, 1);
const later = ordinary.defineMacro(() => bench.test('later', failingBody));
assert.equal(later().definitionLocations.length, 2);
console.log('bench macro locations passed');
`;
