import { Random } from 'fast-check';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { generatorContext } from '../test-support/generator-execution.ts';
import { gen } from './generators.ts';
import { generateInput } from './generator-input.ts';
import type { GeneratorContext } from './generator-backend.ts';

type ReconstructionWork = {
    readonly context: GeneratorContext;
    readonly limit: (remaining: number) => void;
    readonly measure: (body: () => unknown) => number;
};

function reconstructionWork(): ReconstructionWork {
    let remaining = 10_000;
    let consumed = 0;
    return {
        context: {
            ...generatorContext(8, 3, 10_000),
            consumeWork() {
                if (remaining === 0) {
                    throw new Error('Reconstruction work exhausted.');
                }
                remaining -= 1;
                consumed += 1;
            }
        },
        limit(value: number) {
            remaining = value;
        },
        measure(body: () => unknown) {
            const before = consumed;
            body();
            return consumed - before;
        }
    };
}

export const testNode = suite('generator reconstruction work', [
    test('bounds reconstruction without corrupting the retained candidate', function (scope: TestScope) {
        const work = reconstructionWork();
        const root = generateInput(
            gen.array(gen.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 8 }),
            new Random(xoroshiro128plus(42)),
            undefined,
            work.context
        );
        const [ candidate ] = Iterator.from(root.shrink()).drop(2).take(1).toArray();
        scope.require.defined(candidate);
        const expected = candidate.reconstruct();
        work.limit(work.measure(root.reconstruct));
        scope.assert.throws(function exhaustReconstruction() {
            candidate.reconstruct();
        }, { message: 'Reconstruction work exhausted.' });
        work.limit(10_000);
        scope.assert.deepEqual(candidate.reconstruct(), expected);
        return scope.assert.collect();
    }),
    test('bounds candidate production without corrupting retained evidence', function (scope) {
        const work = reconstructionWork();
        const root = generateInput(
            gen.array(gen.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 8 }),
            new Random(xoroshiro128plus(42)),
            undefined,
            work.context
        );
        const expected = root.reconstruct();
        work.limit(0);
        scope.assert.throws(function exhaustCandidateProduction() {
            root.shrink().next();
        }, { message: 'Reconstruction work exhausted.' });
        work.limit(10_000);
        scope.assert.deepEqual(root.reconstruct(), expected);
        return scope.assert.collect();
    }),
    test('charges skipped path candidates during reconstruction', function (scope: TestScope) {
        const work = reconstructionWork();
        const root = generateInput(
            gen.integer({ min: 0, max: 1000 }),
            new Random(xoroshiro128plus(42)),
            undefined,
            work.context
        );
        const candidates = Iterator.from(root.shrink()).take(3).toArray();
        const first = candidates[0];
        const later = candidates[2];
        scope.require.defined(first);
        scope.require.defined(later);
        scope.assert.equal(work.measure(later.reconstruct) > work.measure(first.reconstruct), true);
        return scope.assert.collect();
    }),
    test('bounds impossible filters and retains domain exhaustion signals', function (scope) {
        scope.assert.throws(function impossibleFilter() {
            generateInput(
                gen.constant(1).filter(function rejected() {
                    return false;
                }),
                new Random(xoroshiro128plus(42)),
                undefined,
                generatorContext(3, 2, 25)
            );
        }, { message: 'Generator work exhausted.' });
        scope.assert.throws(function excludedMinimum() {
            generateInput(
                gen.bytes({ minLength: 2, maxLength: 3 }),
                new Random(xoroshiro128plus(42)),
                undefined,
                generatorContext(1, 2, 100)
            );
        }, { message: 'Generator domain exhausted.' });
        return scope.assert.collect();
    }),
    test('retains callback exceptions from reconstruction and shrink traversal', function (scope) {
        let throwCallback = false;
        const generator = gen.integer({ min: 1, max: 100 }).map(function callback(value) {
            if (throwCallback) {
                throw new TypeError('Generator callback failed.');
            }
            return { value };
        });
        const root = generateInput(
            generator,
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(8, 3, 10_000)
        );
        throwCallback = true;
        scope.assert.throws(function reconstructCallback() {
            root.reconstruct();
        }, { name: 'TypeError', message: 'Generator callback failed.' });
        scope.assert.throws(function shrinkCallback() {
            root.shrink().next();
        }, { name: 'TypeError', message: 'Generator callback failed.' });
        return scope.assert.collect();
    }),
    test('reports missing paths when callbacks violate deterministic reconstruction', function (scope: TestScope) {
        let changed = false;
        const generator = gen.constant(null).flatMap(function changingDomain() {
            return changed ? gen.constant<number>(1) : gen.integer({ min: 1, max: 100 });
        });
        const root = generateInput(
            generator,
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(8, 3, 10_000)
        );
        const [ child ] = Iterator.from(root.shrink()).take(1).toArray();
        scope.require.defined(child);
        changed = true;
        scope.assert.throws(function missingPath() {
            child.reconstruct();
        }, { message: 'Retained generator path could not be reconstructed.' });
        return scope.assert.collect();
    }),
    test('retains distinct shrink paths for mappings with repeated outputs', function (scope) {
        const root = generateInput(
            gen.integer({ min: 1, max: 100 }).map(function repeatedOutput() {
                return { value: 'same' };
            }),
            new Random(xoroshiro128plus(42)),
            undefined,
            generatorContext(0, 0, 10_000)
        );
        const children = Iterator.from(root.shrink()).take(5).toArray();
        scope.assert.equal(children.length > 1, true);
        for (const child of children) {
            child.reconstruct().value = 'changed';
            scope.assert.deepEqual(child.reconstruct(), { value: 'same' });
        }
        return scope.assert.collect();
    })
]);
