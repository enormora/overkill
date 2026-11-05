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
assert.deepEqual(Object.keys(leaf).sort(), ['defineCodec', 'gen', 'property', 'withProperties']);
assert.deepEqual(Object.keys(standard).sort(), ['defineCodec', 'gen', 'property', 'withProperties']);
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
assert.deepEqual(Object.keys(property).sort(), ['defineCodec', 'gen', 'property', 'withProperties']);
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

export const propertyCodecScript = `
import assert from 'node:assert/strict';
import {
    capturePropertyInput, decodePropertyInput, migratePropertyInput, defineCodec
} from '@overkill-dev/run/property-codec';
const consume = () => {};
const historical = defineCodec({ name: 'counter', version: 1, previousDecoders: [],
    encode: value => value.toString(), decode: value => BigInt(value) });
const current = defineCodec({ name: 'counter', version: 2,
    previousDecoders: [{ version: 1, decode: value => BigInt(value) }],
    encode: value => ({ decimal: value.toString() }), decode: value => BigInt(value.decimal) });
const original = capturePropertyInput(42n, historical, consume);
const migrated = migratePropertyInput(original, current, consume);
assert.equal(original.codec.version, 1);
assert.equal(migrated.codec.version, 2);
assert.equal(decodePropertyInput(migrated, current, consume), 42n);
console.log('property codecs passed');
`;

const propertyReplayFixture = `
import { property, withProperties, gen } from '@overkill-dev/property';
import { createSuite, createTestCase } from '@overkill-dev/engine';

export const observations = { direct: [], nested: [], surrounding: [], cleanup: [], after: 0 };
const generator = gen.constant(0).map(function forbidGeneration() {
    throw new Error('Witness replay must not generate target inputs.');
});
function checkRetainedInput(value, sample, label) {
    sample.plan(3);
    sample.cleanup(function finishTrial() { observations.cleanup.push(label); });
    observations[label].push(value.left.number);
    sample.assert.true(value.left === value.right);
    sample.assert.true(value.self === value);
    sample.assert.equal(value.left.number, 42);
    value.left.number = 0;
    return sample.assert.collect();
}
const direct = property({ title: 'direct', generator, test(value, sample) {
    return checkRetainedInput(value, sample, 'direct');
} });
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] };
const nested = createTestCase({ ...metadata, title: 'nested', body: withProperties(async function (parent) {
    parent.cleanup(function finishCase() { observations.cleanup.push('case'); });
    await parent.forall(gen.constant(7), function (value, sample) {
        observations.surrounding.push(value);
        sample.cleanup(function finishSurroundingTrial() { observations.cleanup.push('surrounding'); });
        sample.assert.equal(value, 7);
        return sample.assert.collect();
    });
    await parent.forall({ key: 'saved', generator, test(value, sample) {
        return checkRetainedInput(value, sample, 'nested');
    } });
    observations.after += 1;
    return parent.assert.collect();
}) });
export const testNode = createSuite({ ...metadata, title: 'laws', children: [ direct, nested ] });
`;

export const propertyReplayScript = `
import { commandLineRunner } from '@overkill-dev/run/command-line';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { normalizeConfig, orchestrator } from '@overkill-dev/run';
import { capturePropertyInput } from '@overkill-dev/run/property-codec';
import { parseWitnessFile } from '@overkill-dev/engine';

const cwd = await mkdtemp(path.join(process.cwd(), 'witness-replay-'));
try {
await writeFile(path.join(cwd, 'law.mjs'), ${JSON.stringify(propertyReplayFixture)});
const { observations } = await import(pathToFileURL(path.join(cwd, 'law.mjs')).href);
const config = normalizeConfig({ runtimeStateDir: path.join(cwd, 'state'), profiles: { laws: {
    testFamily: 'property', files: { include: [ 'law.mjs' ] },
    execution: { processModel: 'in-process', scheduling: 'serial' },
    property: { newTrials: 2, maxAutomaticEdges: 0, maxExhaustiveValues: 0 }
} } });
const command = { config, cwd, engine: { kind: 'default' }, request: {
    profile: 'laws', seed: { value: 42n }, capture: 'buffered', record: false, lastFailed: false,
    baselineUpdateMode: 'none', capabilityRestrictions: { mode: 'enabled' }, coverage: false,
    debug: { mode: 'off', selectors: [] }, execution: { mode: 'profile-default' },
    measureProcessUsage: null, order: 'lexical', paths: [], processBudgetOverrides: null,
    processUsageSamplingIntervalMilliseconds: null, selection: { kind: 'all' },
    shard: { index: 1, total: 1 }, timingCollection: 'profile-default', verbose: false, workers: null
} };
const resolved = await orchestrator.resolve(command);
const shared = { number: 42 };
const value = { left: shared, right: shared, self: null };
value.self = value;
const counterexample = capturePropertyInput(value, null, () => {});
async function replay(title, target, selectedCommand) {
    const selected = resolved.facts.cases.find(function ownsTitle(entry) { return entry.id.title === title; });
    assert.ok(selected);
    const witness = parseWitnessFile({
        version: 1, kind: 'property', producedBy: { library: '@overkill-dev/property', libraryVersion: '0.0.0' },
        case: selected.id, runtimes: selected.workId.runtimes, seed: '42', target,
        counterexample, failureIdentity: null, shrinkPath: null
    });
    const file = path.join(cwd, title + '.witness.json');
    await writeFile(file, JSON.stringify(witness));
    const result = await orchestrator.replayWitness({ ...selectedCommand, request: {
        path: file, profile: 'laws', seed: { value: 42n }, capture: 'buffered',
        record: false, timingCollection: 'profile-default'
    } }, { signal: null, timing: null });
    assert.deepEqual(result.runnerErrors, []);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.perTest.length, 1);
    assert.equal(result.perTest[0].property.invocations.at(-1).confirmedWitness, null);
}
await replay('direct', { kind: 'property-value' }, command);
await replay('direct', { kind: 'property-value' }, command);
await replay('nested', { kind: 'forall', key: 'saved', occurrence: 0, location: { kind: 'unknown' } }, command);
assert.deepEqual(observations.direct, [ 42, 42 ]);
assert.deepEqual(observations.nested, [ 42 ]);
assert.deepEqual(observations.surrounding, [ 7, 7 ]);
assert.equal(observations.after, 1);
assert.deepEqual(observations.cleanup, [ 'direct', 'direct', 'surrounding', 'surrounding', 'nested', 'case' ]);
const supervisedCommand = { ...command, config: normalizeConfig({
    runtimeStateDir: path.join(cwd, 'supervised-state'), profiles: { laws: {
        testFamily: 'property', files: { include: [ 'law.mjs' ] },
        execution: { processModel: 'supervised-process', scheduling: 'serial' },
        property: { newTrials: 2, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
        timeouts: { collectionMilliseconds: 20000, softMilliseconds: 5000, hardMilliseconds: 10000 }
    } }
}) };
await replay('direct', { kind: 'property-value' }, supervisedCommand);
await replay('nested', {
    kind: 'forall', key: 'saved', occurrence: 0, location: { kind: 'unknown' }
}, supervisedCommand);
await writeFile(path.join(cwd, 'smoke.config.mjs'), 'export const config = ' + JSON.stringify({
    runtimeStateDir: './cli-state', profiles: { laws: {
        testFamily: 'property', files: { include: [ 'law.mjs' ] },
        execution: { processModel: 'in-process', scheduling: 'serial' },
        property: { newTrials: 2, maxAutomaticEdges: 0, maxExhaustiveValues: 0 }
    } }
}));
const cli = await commandLineRunner.replayWitness({
    cwd, configPath: 'smoke.config.mjs', replayRequest: {
        path: path.join(cwd, 'direct.witness.json'), profile: null, seed: { value: 42n },
        capture: 'buffered', record: false, timingCollection: 'profile-default'
    }
});
assert.equal(cli.exitCode, 0);
assert.deepEqual(cli.fallbackDiagnostics, []);
assert.equal(cli.runResult.summary.passed, 1);
console.log('Packaged witness replay passed: ' +
    'direct, nested, fresh graphs, aliases, cycles, cleanup, supervision, and CLI dispatch.');

} finally { await rm(cwd, { recursive: true, force: true }); }
`;
