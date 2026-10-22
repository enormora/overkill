import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    generatedCandidate,
    generatedValues,
    generatorContext,
    shrinkCandidates
} from '../test-support/generator-execution.ts';
import { gen } from './generators.ts';
import { prepareGenerator } from './generator.ts';
import type { RecursiveGeneratorDefinition } from './generator-constraints.ts';

type Tree = { readonly left: Tree; readonly right: Tree; } | null;

function treeDepth(tree: Tree): number {
    return tree === null ? 0 : 1 + Math.max(treeDepth(tree.left), treeDepth(tree.right));
}

function hasLeafLeftBranches(tree: Tree): boolean {
    return tree === null || tree.left === null && hasLeafLeftBranches(tree.right);
}

function treeDefinition(maxDepth: number): RecursiveGeneratorDefinition<Tree> {
    return {
        leaf: gen.constant(null),
        branch(child) {
            return gen.record({ left: child, right: child });
        },
        maxDepth
    };
}

export const testNode = suite('recursive generators', [
    test('uses only the leaf at zero depth without invoking the branch callback', function (scope) {
        const tree = gen.recursive<Tree>({
            leaf: gen.constant(null),
            branch() {
                throw new Error('Zero depth must not expand.');
            },
            maxDepth: 5
        });
        scope.assert.deepEqual(generatedValues(tree, 5, generatorContext(10, 0, 1000)), [
            null,
            null,
            null,
            null,
            null
        ]);
        scope.assert.deepEqual(generatedValues(gen.recursive(treeDefinition(0)), 5, generatorContext(10, 10, 1000)), [
            null,
            null,
            null,
            null,
            null
        ]);
        return scope.assert.collect();
    }),
    test('preserves declaration and policy depths throughout recursive shrinking', function (scope) {
        for (const limits of [ { declared: 4, policy: 2 }, { declared: 2, policy: 4 }, { declared: 1, policy: 1 } ]) {
            const maximum = Math.min(limits.declared, limits.policy);
            const domain = prepareGenerator(
                gen.recursive(treeDefinition(limits.declared)),
                generatorContext(3, limits.policy, 2_000_000)
            );
            const traversals = Array.from({ length: 20 }, function traverse(_value, seed) {
                const root = generatedCandidate(domain, seed);
                return { root, candidates: shrinkCandidates(domain, root, 100) };
            });
            for (const { root, candidates } of traversals) {
                for (const candidate of [ root, ...candidates ]) {
                    scope.assert.equal(treeDepth(candidate.value) <= maximum, true);
                }
            }
            scope.assert.equal(
                traversals.some(function expanded(value) {
                    return value.root.value !== null;
                }),
                true
            );
            scope.assert.equal(
                traversals.some(function collapsed(value) {
                    return value.root.value !== null && value.candidates.some(function leaf(candidate) {
                        return candidate.value === null;
                    });
                }),
                true
            );
        }
        return scope.assert.collect();
    }),
    test('retains remaining recursive depth during dependent regeneration', function (scope) {
        const tree = gen.recursive<Tree>({
            leaf: gen.constant(null),
            branch(child) {
                return gen.integer({ min: 0, max: 8 }).flatMap(function dependentBranch(length) {
                    return gen.array(child, { minLength: length, maxLength: length }).map(
                        function firstChild(children): Tree {
                            return { left: children[0] ?? null, right: children[1] ?? null };
                        }
                    );
                });
            },
            maxDepth: 3
        });
        const domain = prepareGenerator(tree, generatorContext(8, 2, 5_000_000));
        let examined = 0;
        for (let seed = 0; seed < 20; seed += 1) {
            const root = generatedCandidate(domain, seed);
            for (const candidate of [ root, ...shrinkCandidates(domain, root, 100) ]) {
                scope.assert.equal(treeDepth(candidate.value) <= 2, true);
                examined += 1;
            }
        }
        scope.assert.equal(examined > 100, true);
        return scope.assert.collect();
    }),
    test('honors stricter limits when a child is embedded in another recursive domain', function (scope) {
        const tree = gen.recursive<Tree>({
            leaf: gen.constant(null),
            branch(child) {
                return gen.record({
                    left: gen.recursive<Tree>({
                        leaf: child,
                        branch() {
                            throw new Error('Nested zero depth must not expand.');
                        },
                        maxDepth: 0
                    }),
                    right: child
                });
            },
            maxDepth: 4
        });
        const domain = prepareGenerator(tree, generatorContext(5, 4, 2_000_000));
        for (let seed = 0; seed < 20; seed += 1) {
            const root = generatedCandidate(domain, seed);
            const candidates = [ root, ...shrinkCandidates(domain, root, 100) ];
            scope.assert.equal(
                candidates.every(function bounded(candidate) {
                    return hasLeafLeftBranches(candidate.value) && treeDepth(candidate.value) <= 4;
                }),
                true
            );
        }
        return scope.assert.collect();
    }),
    test('snapshots recursive definitions and rejects invalid declarations', function (scope) {
        const definition = { ...treeDefinition(2) };
        const generator = gen.recursive(definition);
        definition.maxDepth = 0;
        definition.branch = function changedBranch() {
            throw new Error('Definition changed.');
        };
        scope.assert.equal(
            generatedValues(generator, 20, generatorContext(3, 2, 100_000)).some(function expanded(value) {
                return value !== null;
            }),
            true
        );
        for (const value of [ null, {}, { ...treeDefinition(2), branch: false }, { ...treeDefinition(2), leaf: {} } ]) {
            scope.assert.throws(function invalidDefinition() {
                Reflect.apply(gen.recursive, undefined, [ value ]);
            }, { name: 'TypeError' });
        }
        for (const value of [ -1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_VALUE ]) {
            scope.assert.throws(function invalidDepth() {
                gen.recursive(treeDefinition(value));
            }, { name: 'RangeError' });
        }
        return scope.assert.collect();
    })
]);
