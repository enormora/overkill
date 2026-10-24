import { Random, configureGlobal, readConfigureGlobal, resetConfigureGlobal } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { generatorContext, shrinkDescendants } from '../test-support/generator-execution.ts';
import { gen } from './generators.ts';
import { generateInput, type GeneratedInput } from './generator-input.ts';

// eslint-disable-next-line restricted-syntax/no-class-declaration -- Reconstruction must preserve custom class instances and private state.
class MutableInput {
    private readonly values: number[];
    private readonly alias: number[];
    private self: MutableInput | null = this;
    #index: number;

    public constructor(values: readonly number[], index: number) {
        this.values = Array.from(values);
        this.alias = this.values;
        this.#index = index;
    }

    public read(): number | undefined {
        return this.values[this.#index];
    }

    public hasGraphLinks(): boolean {
        return this.values === this.alias && this.self === this;
    }

    public corrupt(): void {
        this.#index = -1;
        this.values.fill(-1);
        this.self = null;
    }
}

function assertFreshClass(scope: TestScope, retained: GeneratedInput<MutableInput>): void {
    const first = retained.reconstruct();
    const expected = first.read();
    scope.assert.equal(first instanceof MutableInput, true);
    scope.assert.equal(expected !== undefined && expected !== -1, true);
    first.corrupt();
    const fresh = retained.reconstruct();
    scope.assert.equal(fresh instanceof MutableInput, true);
    scope.assert.equal(fresh.read(), expected);
    scope.assert.equal(fresh.hasGraphLinks(), true);
}

type GraphKey = { readonly bytes: Uint8Array; };
type InputGraph = {
    readonly bytes: Uint8Array;
    readonly view: DataView;
    readonly key: GraphKey;
    readonly map: ReadonlyMap<GraphKey, Uint8Array>;
    readonly set: ReadonlySet<GraphKey>;
};

function assertGraphLinks(scope: TestScope, graph: InputGraph): void {
    scope.assert.equal(graph.view.buffer === graph.bytes.buffer, true);
    scope.assert.equal(graph.view.byteOffset, 1);
    scope.assert.equal(graph.view.byteLength, 2);
    scope.assert.equal(graph.map.get(graph.key) === graph.bytes, true);
    scope.assert.equal(graph.set.has(graph.key), true);
    scope.assert.equal(graph.key.bytes === graph.bytes, true);
}

type StatefulInput = { readonly bytes: Uint8Array; readonly branch: boolean; };

function assertRebuiltState(scope: TestScope, retained: GeneratedInput<StatefulInput>): boolean {
    const first = retained.reconstruct();
    const expected = Array.from(first.bytes);
    first.bytes.fill(255);
    const fresh = retained.reconstruct();
    scope.assert.deepEqual(Array.from(fresh.bytes), expected);
    return fresh.branch;
}

export const testNode = suite('generator reconstruction', [
    test('isolates generation and reconstruction from backend global sizing defaults', function (scope) {
        const previous = readConfigureGlobal();
        scope.cleanup(function restoreBackendDefaults() {
            resetConfigureGlobal();
            configureGlobal(previous);
        });
        const generator = gen.record({
            values: gen.array(gen.integer({ min: 0, max: 100 })),
            text: gen.string(),
            bytes: gen.bytes(),
            choice: gen.choice(gen.constant(null), gen.boolean())
        });
        const root = generateInput(
            generator,
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(100, 3, 100_000)
        );
        const expected = root.reconstruct();
        configureGlobal({ baseSize: 'large', defaultSizeToMaxWhenMaxSpecified: true });
        scope.assert.deepEqual(root.reconstruct(), expected);
        scope.assert.deepEqual(
            generateInput(
                generator,
                new Random(xoroshiro128plus(42)),
                undefined,
                generatorContext(100, 3, 100_000)
            )
                .reconstruct(),
            expected
        );
        return scope.assert.collect();
    }),
    test('reconstructs dependent custom classes without sharing mutable source graphs', function (scope) {
        const generator = gen.array(gen.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 8 }).flatMap(
            function indexedInput(values) {
                return gen.integer({ min: 0, max: values.length - 1 }).map(function customInput(index) {
                    return new MutableInput(values, index);
                });
            }
        );
        const root = generateInput(
            generator,
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(8, 3, 100_000)
        );
        const descendants = shrinkDescendants(root, 50, function children(candidate) {
            return candidate.shrink();
        });
        for (const retained of [ root, ...descendants ]) {
            assertFreshClass(scope, retained);
        }
        scope.assert.equal(descendants.length > 3, true);
        scope.assert.equal(root.reconstruct().read() !== -1, true);
        return scope.assert.collect();
    }),
    test('preserves shared backing stores and collection identities within fresh graphs', function (scope) {
        const generator = gen.bytes({ minLength: 4, maxLength: 8 }).map(function inputGraph(bytes) {
            const view = new DataView(bytes.buffer, 1, 2);
            const key = { bytes };
            return { bytes, view, key, map: new Map([ [ key, bytes ] ]), set: new Set([ key ]) };
        });
        const retained = generateInput(
            generator,
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(8, 2, 10_000)
        );
        const first = retained.reconstruct();
        const expected = Array.from(first.bytes);
        first.view.setUint8(0, 255);
        const fresh = retained.reconstruct();
        scope.assert.deepEqual(Array.from(fresh.bytes), expected);
        assertGraphLinks(scope, fresh);
        scope.assert.equal(fresh.bytes.buffer === first.bytes.buffer, false);
        return scope.assert.collect();
    }),
    test('reconstruction and shrinking leave subsequent exploration unchanged', function (scope) {
        const generator = gen.record({ values: gen.array(gen.integer({ min: 0, max: 100 })), flag: gen.boolean() });
        const random = new Random(xoroshiro128plus(42));
        const context = generatorContext(8, 3, 100_000);
        const root = generateInput(generator, random, 2, context);
        const expectedRandom = random.clone();
        root.reconstruct().values.fill(-1);
        Iterator.from(root.shrink()).take(5).forEach(function corruptChild(child) {
            child.reconstruct().values.fill(-1);
            child.reconstruct();
        });
        scope.assert.deepEqual(
            generateInput(generator, random, 2, context).reconstruct(),
            generateInput(generator, expectedRandom, 2, context).reconstruct()
        );
        return scope.assert.collect();
    }),
    test('isolates mutable Map and Set containers between reconstructions', function (scope) {
        const retained = generateInput(
            gen.constant(null).map(function collections() {
                return { map: new Map([ [ 'key', 1 ] ]), set: new Set([ 1 ]) };
            }),
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(0, 0, 100)
        );
        const first = retained.reconstruct();
        first.map.clear();
        first.set.clear();
        scope.assert.deepEqual(retained.reconstruct().map, new Map([ [ 'key', 1 ] ]));
        scope.assert.deepEqual(retained.reconstruct().set, new Set([ 1 ]));
        return scope.assert.collect();
    }),
    test('rebuilds mutable state captured during recursive domain construction', function (scope) {
        const generator = gen.recursive<StatefulInput>({
            leaf: gen.bytes({ minLength: 1, maxLength: 1 }).map<StatefulInput>(function leaf(bytes) {
                return { bytes, branch: false };
            }),
            branch() {
                const bytes = Uint8Array.of(1);
                return gen.constant(null).map<StatefulInput>(function branchState() {
                    return { bytes, branch: true };
                });
            },
            maxDepth: 1
        });
        let expanded = 0;
        for (let seed = 0; seed < 10; seed += 1) {
            const retained = generateInput(
                generator,
                new Random(xoroshiro128plus(seed)),
                undefined,
                generatorContext(1, 1, 1000)
            );
            expanded += Number(assertRebuiltState(scope, retained));
        }
        scope.assert.equal(expanded > 0, true);
        return scope.assert.collect();
    }),
    test('repeats the same shrink sequence for equal retained contexts', function (scope) {
        const generator = gen.record({ values: gen.array(gen.integer({ min: 0, max: 100 })), flag: gen.boolean() });
        const context = generatorContext(8, 3, 100_000);
        const root = generateInput(generator, new Random(xoroshiro128plus(42)), 2, context);
        const repeated = generateInput(generator, new Random(xoroshiro128plus(42)), 2, context);
        scope.assert.deepEqual(
            Iterator
                .from(root.shrink())
                .take(5)
                .map(function input(candidate) {
                    return candidate.reconstruct();
                })
                .toArray(),
            Iterator
                .from(repeated.shrink())
                .take(5)
                .map(function input(candidate) {
                    return candidate.reconstruct();
                })
                .toArray()
        );
        return scope.assert.collect();
    })
]);
