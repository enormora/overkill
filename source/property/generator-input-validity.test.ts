import { Random } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    generatedCandidate,
    generatorContext,
    shrinkCandidates,
    shrinkDescendants
} from '../test-support/generator-execution.ts';
import { gen } from './generators.ts';
import { generateInput, type GeneratedInput } from './generator-input.ts';
import { prepareGenerator } from './generator.ts';

type IndexedInput = {
    readonly values: readonly number[];
    readonly index: number;
    readonly dependent: readonly number[];
    readonly text: string;
    readonly bytes: Uint8Array;
};

type Tree = readonly Tree[] | null;

function treeDepth(tree: Tree): number {
    return tree === null ? 0 : 1 + Math.max(0, ...tree.map(treeDepth));
}

function treeWidth(tree: Tree): number {
    return tree === null ? 0 : Math.max(tree.length, ...tree.map(treeWidth));
}

function assertIndexedDomain(scope: TestScope, value: IndexedInput): void {
    scope.assert.equal(value.values.length > 0 && value.values.length <= 3, true);
    scope.assert.equal(value.index >= 0 && value.index < value.values.length, true);
    scope.assert.equal(value.dependent.length <= 3, true);
    scope.assert.equal(
        value.dependent.every(function withinBounds(element) {
            return element >= 0 && element <= value.values.length;
        }),
        true
    );
    scope.assert.equal(value.text.length > 0 && value.text.length <= 3, true);
    scope.assert.equal(value.bytes.length > 0 && value.bytes.length <= 3, true);
}

const indexedGenerator = gen.array(gen.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 8 }).flatMap(
    function indexedArray(values) {
        return gen.record({
            values: gen.constant(null).map(function retainedArray() {
                return values;
            }),
            index: gen.integer({ min: 0, max: values.length - 1 }),
            dependent: gen.array(gen.integer({ min: 0, max: values.length })),
            text: gen.string({ minLength: 1, maxLength: 8 }),
            bytes: gen.bytes({ minLength: 1, maxLength: 8 })
        });
    }
);

function assertDependentTraversal(scope: TestScope, seed: number): number {
    const root = generateInput(
        indexedGenerator,
        new Random(xoroshiro128plus(seed)),
        undefined,
        generatorContext(3, 2, 100_000)
    );
    const descendants = shrinkDescendants(root, 30, function children(candidate) {
        return candidate.shrink();
    });
    for (const candidate of [ root, ...descendants ]) {
        const value = candidate.reconstruct();
        assertIndexedDomain(scope, value);
        value.values.length = 0;
        value.dependent.fill(-1);
        value.bytes.fill(255);
        assertIndexedDomain(scope, candidate.reconstruct());
    }
    return descendants.length;
}

function assertRecursiveTraversal(scope: TestScope, maxDepth: number, seed: number): number {
    const generator = gen.recursive<Tree>({
        leaf: gen.constant(null),
        branch(child) {
            return gen.integer({ min: 1, max: 3 }).flatMap(function dependentBranch(length) {
                return gen.array(child, { minLength: length, maxLength: length }).map<Tree>(
                    function recursiveValue(children) {
                        return children;
                    }
                );
            });
        },
        maxDepth: 3
    });
    const context = { ...generatorContext(3, maxDepth, 100_000) };
    const root = generateInput(generator, new Random(xoroshiro128plus(seed)), undefined, context);
    Object.assign(context, { maxDepth: 10, maxSize: 10 });
    const candidates = [
        root,
        ...shrinkDescendants(root, 20, function children(candidate) {
            return candidate.shrink();
        })
    ];
    for (const candidate of candidates) {
        scope.assert.equal(treeDepth(candidate.reconstruct()) <= Math.min(maxDepth, 3), true);
        scope.assert.equal(treeWidth(candidate.reconstruct()) <= 3, true);
    }
    return candidates
        .filter(function expanded(candidate) {
            return candidate.reconstruct() !== null;
        })
        .length;
}

type MappedInput = { readonly source: number; readonly display: number; readonly repeated: readonly string[]; };

function assertMappedInput(scope: TestScope, candidate: GeneratedInput<MappedInput>): void {
    const value = candidate.reconstruct();
    scope.assert.equal(value.source % 2, 0);
    scope.assert.equal(value.display, 1 / value.source);
    scope.assert.deepEqual(candidate.reconstruct().repeated, [ 'same', 'same' ]);
}

export const testNode = suite('reconstructed generator validity', [
    test('reconstructs the exact dependent candidates selected by contextual shrinking', function (scope: TestScope) {
        const domain = prepareGenerator(indexedGenerator, generatorContext(3, 2, 100_000));
        const root = generatedCandidate(domain, 42);
        const retained = generateInput(
            indexedGenerator,
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(3, 2, 100_000)
        );
        const expected = [ root, ...shrinkCandidates(domain, root, 50) ].map(function input(candidate) {
            return candidate.value;
        });
        const actual = [
            retained,
            ...shrinkDescendants(retained, 50, function children(candidate) {
                return candidate.shrink();
            })
        ]
            .map(function input(candidate) {
                return candidate.reconstruct();
            });
        scope.assert.equal(actual.length, expected.length);
        actual.forEach(function expectedCandidate(value, index) {
            const expectedInput = expected[index];
            scope.require.defined(expectedInput);
            scope.assert.deepEqual(value, expectedInput);
        });
        scope.assert.equal(actual.length > 10, true);
        return scope.assert.collect();
    }),
    test('retains dependent indexes, changing element bounds, and container caps', function (scope) {
        let examined = 0;
        for (let seed = 0; seed < 10; seed += 1) {
            examined += assertDependentTraversal(scope, seed);
        }
        scope.assert.equal(examined > 30, true);
        return scope.assert.collect();
    }),
    test('snapshots limits and retains recursive depth through dependent reconstruction', function (scope) {
        let expanded = 0;
        for (const maxDepth of [ 0, 1, 2, 4 ]) {
            for (let seed = 0; seed < 10; seed += 1) {
                expanded += assertRecursiveTraversal(scope, maxDepth, seed);
            }
        }
        scope.assert.equal(expanded > 0, true);
        return scope.assert.collect();
    }),
    test('preserves filtering and permits repeated and expanding mapped outputs', function (scope) {
        const generator = gen
            .integer({ min: 1, max: 100 })
            .filter(function even(value) {
                return value % 2 === 0;
            })
            .map(function expanded(value) {
                return { source: value, display: 1 / value, repeated: [ 'same', 'same' ] };
            });
        const root = generateInput(
            generator,
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(0, 0, 10_000)
        );
        const candidates = Iterator.from(root.shrink()).take(10).toArray();
        scope.assert.equal(candidates.length > 0, true);
        for (const candidate of [ root, ...candidates ]) {
            assertMappedInput(scope, candidate);
        }
        scope.assert.equal(
            candidates.some(function largerDisplay(candidate) {
                return candidate.reconstruct().display > root.reconstruct().display;
            }),
            true
        );
        return scope.assert.collect();
    })
]);
