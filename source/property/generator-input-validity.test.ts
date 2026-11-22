import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, table, test, type TestScope } from '@overkill-dev/test';

import { Random } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';

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

const assertIndexedDomain = defineCompositeAssertion({
    name: 'indexed domain',
    assert(check, value: IndexedInput) {
        return check.group([
            check.equal(value.values.length > 0 && value.values.length <= 3, true),
            check.equal(value.index >= 0 && value.index < value.values.length, true),
            check.equal(value.dependent.length <= 3, true),
            check.equal(
                value.dependent.every(function withinBounds(element) {
                    return element >= 0 && element <= value.values.length;
                }),
                true
            ),
            check.equal(value.text.length > 0 && value.text.length <= 3, true),
            check.equal(value.bytes.length > 0 && value.bytes.length <= 3, true)
        ]);
    }
});

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

type MappedInput = { readonly source: number; readonly display: number; readonly repeated: readonly string[]; };

const assertMappedInput = defineCompositeAssertion({
    name: 'mapped input',
    assert(check, candidate: GeneratedInput<MappedInput>) {
        const value = candidate.reconstruct();
        return check.group([
            check.equal(value.source % 2, 0),
            check.equal(value.display, 1 / value.source),
            check.deepEqual(candidate.reconstruct().repeated, [ 'same', 'same' ])
        ]);
    }
});

const seeds = Array.from({ length: 10 }, function (_value, seed) {
    return seed;
});
const recursiveLimits = [ 0, 1, 2, 4 ];
const recursiveGenerator = gen.recursive<Tree>({
    leaf: gen.constant(null),
    branch(child) {
        return gen.integer({ min: 1, max: 3 }).flatMap(function dependentBranch(length) {
            return gen.array(child, { minLength: length, maxLength: length }).map<Tree>(function (children) {
                return children;
            });
        });
    },
    maxDepth: 3
});
function indexedCandidates(seed: number): readonly GeneratedInput<IndexedInput>[] {
    const root = generateInput(
        indexedGenerator,
        new Random(xoroshiro128plus(seed)),
        undefined,
        generatorContext(3, 2, 100_000)
    );
    return [
        root,
        ...shrinkDescendants(root, 30, function (candidate) {
            return candidate.shrink();
        })
    ];
}
function recursiveCandidates(maxDepth: number, seed: number): readonly GeneratedInput<Tree>[] {
    const context = { ...generatorContext(3, maxDepth, 100_000) };
    const root = generateInput(recursiveGenerator, new Random(xoroshiro128plus(seed)), undefined, context);
    Object.assign(context, { maxDepth: 10, maxSize: 10 });
    return [
        root,
        ...shrinkDescendants(root, 20, function (candidate) {
            return candidate.shrink();
        })
    ];
}
const recursiveBounds = defineCompositeAssertion({
    name: 'retained recursive limits',
    assert(check, candidate: GeneratedInput<Tree>, maxDepth: number) {
        return check.group([
            check.equal(treeDepth(candidate.reconstruct()) <= Math.min(maxDepth, 3), true),
            check.equal(treeWidth(candidate.reconstruct()) <= 3, true)
        ]);
    }
});

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
    table({
        title: 'retains dependent indexes and container caps after mutation',
        cases: seeds,
        caseTitle(seed) {
            return `seed ${seed}`;
        },
        test({ assert, parameters: seed }) {
            for (const candidate of indexedCandidates(seed)) {
                const value = candidate.reconstruct();
                assert(assertIndexedDomain, value);
                Reflect.set(value.values, 'length', 0);
                Reflect.apply(Array.prototype.fill, value.dependent, [ -1 ]);
                value.bytes.fill(255);
                assert(assertIndexedDomain, candidate.reconstruct());
            }
            return assert.collect();
        }
    }),
    test('explores more than thirty dependent shrink descendants', function (scope) {
        scope.assert.equal(
            seeds.reduce(function (count, seed) {
                return count + indexedCandidates(seed).length - 1;
            }, 0) > 30,
            true
        );
        return scope.assert.collect();
    }),
    table({
        title: 'snapshots recursive limits through dependent reconstruction',
        cases: recursiveLimits.flatMap(function (maxDepth) {
            return seeds.map(function (seed) {
                return { maxDepth, seed };
            });
        }),
        caseTitle({ maxDepth, seed }) {
            return `depth ${maxDepth}, seed ${seed}`;
        },
        test({ assert, parameters: { maxDepth, seed } }) {
            for (const candidate of recursiveCandidates(maxDepth, seed)) {
                assert(recursiveBounds, candidate, maxDepth);
            }
            return assert.collect();
        }
    }),
    test('explores non-null recursive branches', function (scope) {
        scope.assert.equal(
            recursiveLimits.some(function (maxDepth) {
                return seeds.some(function (seed) {
                    return recursiveCandidates(maxDepth, seed).some(function (candidate) {
                        return candidate.reconstruct() !== null;
                    });
                });
            }),
            true
        );
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
            scope.assert(assertMappedInput, candidate);
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
