export const propertyAuthoringScript = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRoot, createTestPlan, execute, readTestBodyFamily } from '@overkill-dev/engine';
import { suite, test, defineMacro } from '@overkill-dev/test';
import * as leaf from '@overkill-dev/property';
import * as standard from '@overkill-dev/test/property';

function rejectExecution() { throw new Error('Authoring evaluated a callback.'); }
const generator = leaf.gen.constant(null).map(rejectExecution);
assert.deepEqual(Object.keys(leaf).sort(), ['gen', 'property', 'withProperties']);
assert.deepEqual(Object.keys(standard).sort(), ['gen', 'property', 'withProperties']);
const leafBackend = new URL('../../property/generator.js', import.meta.resolve('@overkill-dev/property'));
const { prepareGenerator: leafCompiler } = await import(leafBackend);
const standardManifest = findPackageJSON('@overkill-dev/property', import.meta.resolve('@overkill-dev/test/property'));
const standardBackend = new URL('./property/generator.js', pathToFileURL(standardManifest));
const { prepareGenerator: standardCompiler } = await import(standardBackend);
const { check, property: checkProperty } = await import('fast-check');
for (const [first, second, compiler] of [[leaf, standard, standardCompiler], [standard, leaf, leafCompiler]]) {
    let remaining = 10_000;
    const context = {
        maxSize: 4, maxDepth: 2,
        consumeWork() { if (--remaining < 0) throw new Error('Work exhausted.'); },
        exhaustDomain() { throw new Error('Domain exhausted.'); }
    };
    const composed = first.gen.integer({min: 1, max: 5}).flatMap(value => second.gen.record({
        value: first.gen.constant(value),
        index: second.gen.integer({min: 0, max: value - 1})
    }));
    const domain = compiler(composed, context);
    const candidates = [];
    const failing = checkProperty(domain, input => { candidates.push(input); return false; });
    const result = check(failing, {seed: 42, numRuns: 1});
    assert.equal(result.failed, true);
    assert.equal(result.errorInstance?.message, 'Property failed by returning false');
    assert(candidates.length > 0);
    assert(candidates.every(input => input.index >= 0 && input.index < input.value));
}
const macro = defineMacro(() => leaf.property({ title: 'leaf', generator, test: rejectExecution }));
const first = macro();
const second = standard.property({ title: 'standard', generator, test: rejectExecution });
const nested = test('nested', standard.withProperties(rejectExecution));
const plan = createTestPlan(createRoot({
    title: 'property consumer', annotations: {}, controls: {}, children: [suite('laws', [first, second, nested])]
}));
assert.equal(plan.cases.length, 3);
assert.equal(first.definitionLocations.length, 2);
for (const selected of plan.cases) {
    assert.equal(selected.testFamily, 'property');
    assert.equal(readTestBodyFamily(selected.execution.body).family, 'property');
}
assert.equal(readTestBodyFamily(plan.cases[0].execution.body).definition.generator, generator);
const result = await execute(plan);
assert.equal(result.summary.failed, 3);
assert.equal(result.summary.passed, 0);
assert.match(JSON.stringify(result.perTest), /Property execution requires resolved collection policy/);
const observed = [];
const executable = createTestPlan(createRoot({
    title: 'executed properties', annotations: {}, controls: {}, children: [
        leaf.property({
            title: 'leaf execution', generator: standard.gen.constant(2), examples: [() => 1],
            test(value, sample) {
                observed.push(value);
                sample.assert.true(value > 0);
                return sample.assert.collect();
            }
        }),
        test('nested execution', standard.withProperties(async scope => {
            await scope.forall({generator: leaf.gen.constant(4), examples: [() => 3], test(value, sample) {
                observed.push(value);
                sample.assert.true(value > 0);
                return sample.assert.collect();
            }});
            return scope.assert.collect();
        }))
    ]
}));
const policy = {
    version: 1, newTrials: 2, maxSize: 10, maxDepth: 2, maxAutomaticEdges: 1,
    maxExhaustiveValues: 0, maxWork: 1000, maxShrinkWork: 0, maxLabels: 10, maxRetainedInputs: 10
};
const resolveCases = cases => cases.map(selected => ({
    ...selected, execution: {...selected.execution, policy: {kind: 'resolved', policy}}
}));
const executed = await execute({...executable,
    cases: resolveCases(executable.cases), discoveredCases: resolveCases(executable.discoveredCases)
});
assert.equal(executed.summary.passed, 2, JSON.stringify(executed));
assert.equal(executed.summary.failed, 0);
assert.deepEqual(observed, [1, 2, 2, 2, 3, 4, 4, 4]);
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.resolve('@overkill-dev/test'))));
assert.deepEqual(manifest.exports['./property'], {
    import: './packages/test/property.entry-point.js', types: './packages/test/property.entry-point.d.ts'
});
console.log('property authoring passed');
`;

export const propertySubpathScript = `
import assert from 'node:assert/strict';
const property = await import('@overkill-dev/test/property');
const { test } = await import('@overkill-dev/test');
const node = test('nested', property.withProperties(() => { throw new Error('Body executed during authoring.'); }));
assert.equal(node.kind, 'test');
assert.deepEqual(Object.keys(property).sort(), ['gen', 'property', 'withProperties']);
const real = property.gen.record({ name: property.gen.string(), active: property.gen.boolean() });
const declared = property.property({
    title: 'real generator', generator: real, test() { throw new Error('Body executed.'); }
});
assert.equal(declared.kind, 'test');
console.log('standard property passed');
`;

export const propertyTypeScript = `
import { gen as leaf, type Generator as LeafGenerator } from '@overkill-dev/property';
import {
    gen as standard, property, withProperties, type Generator as StandardGenerator
} from '@overkill-dev/test/property';
import { suite, test } from '@overkill-dev/test';
const leafGenerator = leaf.integer({min: 0, max: 10});
const standardGenerator: StandardGenerator<number> = leafGenerator;
const sameGenerator: LeafGenerator<number> = standardGenerator;
const mixed: LeafGenerator<{ name: string; active: boolean }> = standard.record({
    name: leaf.string(), active: standard.boolean()
});
const reverse: StandardGenerator<[string, boolean]> = leaf.tuple(standard.string(), leaf.boolean());
void mixed;
void reverse;
suite('typed properties', [
    property({ title: 'leaf generator', generator: sameGenerator, test(value, sample) {
        sample.target('value', value);
        sample.assert.equal(value, 1);
        return sample.assert.collect();
    } }),
    test('nested', withProperties(async scope => {
        await scope.forall(standardGenerator, (value, sample) => {
            sample.assert.equal(value, 1);
            return sample.assert.collect();
        });
        return scope.assert.collect();
    }))
]);
`;

export const propertyLoadBoundaryScript = `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const loaded = [];
registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });
const root = await import('@overkill-dev/test');
assert.equal('property' in root, false);
assert.equal('withProperties' in root, false);
assert.equal('gen' in root, false);
assert.equal(loaded.some(url => /fast-check/.test(url)), false);
assert.equal(loaded.some(url => /\\/property\\/|\\/property\\.entry-point\\.js/.test(url)), false);
await import('@overkill-dev/test/property');
assert.equal(loaded.some(url => /\\/property\\/|\\/property\\.entry-point\\.js/.test(url)), true);
console.log('property load boundary passed');
`;

export const microtestLoadBoundaryScript = `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const loaded = [];
registerHooks({ load(url, context, nextLoad) { loaded.push(url); return nextLoad(url, context); } });
process.on('exit', () => {
    assert.equal(loaded.some(url => /\\/property\\/|\\/property\\.entry-point\\.js/.test(url)), false);
    assert.equal(loaded.some(url => /fast-check/.test(url)), false);
});
`;
