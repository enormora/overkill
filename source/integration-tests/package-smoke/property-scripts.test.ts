export const propertyAuthoringScript = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoot, createTestPlan, execute, readTestBodyFamily } from '@overkill-dev/engine';
import { suite, test, defineMacro } from '@overkill-dev/test';
import * as leaf from '@overkill-dev/property';
import * as standard from '@overkill-dev/test/property';

function rejectExecution() { throw new Error('Authoring evaluated a callback.'); }
const generator = {
    [Symbol.for('@overkill-dev/property/Generator')]: true,
    map: rejectExecution, flatMap: rejectExecution, filter: rejectExecution, withCodec: rejectExecution
};
assert.deepEqual(Object.keys(leaf).sort(), ['property', 'withProperties']);
assert.deepEqual(Object.keys(standard).sort(), ['property', 'withProperties']);
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
assert.match(JSON.stringify(result.perTest), /Property execution is not available/);
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
assert.deepEqual(Object.keys(property).sort(), ['property', 'withProperties']);
console.log('standard property passed');
`;

export const propertyTypeScript = `
import type { Generator as LeafGenerator } from '@overkill-dev/property';
import { property, withProperties, type Generator as StandardGenerator } from '@overkill-dev/test/property';
import { suite, test } from '@overkill-dev/test';
declare const leafGenerator: LeafGenerator<number>;
const standardGenerator: StandardGenerator<number> = leafGenerator;
const sameGenerator: LeafGenerator<number> = standardGenerator;
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
});
`;
