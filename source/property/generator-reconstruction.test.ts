import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, table, test } from '@overkill-dev/test';

import { Random, configureGlobal, readConfigureGlobal, resetConfigureGlobal } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';

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

const assertFreshClass = defineCompositeAssertion({
    name: 'fresh class',
    assert(check, retained: GeneratedInput<MutableInput>) {
        const first = retained.reconstruct();
        const expected = first.read();
        const initialChecks = check.group([
            check.equal(first instanceof MutableInput, true),
            check.equal(expected !== undefined && expected !== -1, true)
        ]);
        first.corrupt();
        const fresh = retained.reconstruct();
        return check.group([
            initialChecks,
            check.equal(fresh instanceof MutableInput, true),
            check.equal(fresh.read(), expected),
            check.equal(fresh.hasGraphLinks(), true)
        ]);
    }
});

type GraphKey = { readonly bytes: Uint8Array; };
type InputGraph = {
    readonly bytes: Uint8Array;
    readonly view: DataView;
    readonly key: GraphKey;
    readonly map: ReadonlyMap<GraphKey, Uint8Array>;
    readonly set: ReadonlySet<GraphKey>;
};

const assertGraphLinks = defineCompositeAssertion({
    name: 'graph links',
    assert(check, graph: InputGraph) {
        return check.group([
            check.equal(graph.view.buffer === graph.bytes.buffer, true),
            check.equal(graph.view.byteOffset, 1),
            check.equal(graph.view.byteLength, 2),
            check.equal(graph.map.get(graph.key) === graph.bytes, true),
            check.equal(graph.set.has(graph.key), true),
            check.equal(graph.key.bytes === graph.bytes, true)
        ]);
    }
});

type StatefulInput = { readonly bytes: Uint8Array; readonly branch: boolean; };

const statefulRecursiveGenerator = gen.recursive<StatefulInput>({
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

function statefulCandidate(seed: number): GeneratedInput<StatefulInput> {
    return generateInput(
        statefulRecursiveGenerator,
        new Random(xoroshiro128plus(seed)),
        undefined,
        generatorContext(1, 1, 1000)
    );
}
const freshRecursiveBytes = defineCompositeAssertion({
    name: 'reconstructs the original recursive bytes after mutation',
    assert(check, retained: GeneratedInput<StatefulInput>) {
        const first = retained.reconstruct();
        const expected = Array.from(first.bytes);
        first.bytes.fill(255);
        return check.deepEqual(Array.from(retained.reconstruct().bytes), expected);
    }
});
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
        scope.assert(
            defineCompositeAssertion({
                name: 'isolates generation and reconstruction from backend global sizing defaults',
                assert(check) {
                    return check.group([
                        check.deepEqual(root.reconstruct(), expected),
                        check.deepEqual(
                            generateInput(
                                generator,
                                new Random(xoroshiro128plus(42)),
                                undefined,
                                generatorContext(100, 3, 100_000)
                            )
                                .reconstruct(),
                            expected
                        )
                    ]);
                }
            })
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
            scope.assert(assertFreshClass, retained);
        }
        scope.assert(
            defineCompositeAssertion({
                name: 'reconstructs dependent custom classes without sharing mutable source graphs',
                assert(check) {
                    return check.group([
                        check.equal(descendants.length > 3, true),
                        check.equal(root.reconstruct().read() !== -1, true)
                    ]);
                }
            })
        );
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
        scope.assert(assertGraphLinks, fresh);
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
        scope.assert(
            defineCompositeAssertion({
                name: 'isolates mutable Map and Set containers between reconstructions',
                assert(check) {
                    return check.group([
                        check.deepEqual(retained.reconstruct().map, new Map([ [ 'key', 1 ] ])),
                        check.deepEqual(retained.reconstruct().set, new Set([ 1 ]))
                    ]);
                }
            })
        );
        return scope.assert.collect();
    }),
    table({
        title: 'reconstructs fresh mutable state in recursive branches',
        cases: Array.from({ length: 10 }, function (_value, seed) {
            return seed;
        }),
        caseTitle(seed) {
            return `seed ${seed}`;
        },
        test({ assert, parameters: seed }) {
            assert(freshRecursiveBytes, statefulCandidate(seed));
            return assert.collect();
        }
    }),
    test('explores mutable recursive branches', function (scope) {
        scope.assert.equal(
            Array
                .from({ length: 10 }, function (_value, seed) {
                    return seed;
                })
                .some(function (seed) {
                    return statefulCandidate(seed).reconstruct().branch;
                }),
            true
        );
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
