import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { definition } from '../test-support/benchmark-placement-fixture.ts';
import { defaultBenchmarkLifecyclePolicy } from '../bench/benchmark-lifecycle-policy.ts';
import type { BenchmarkGarbageCollectionRequest } from '../engine/benchmark-result.ts';
import { createCollectedPlan } from './worker-pool-placement-planning.test.ts';
import type { CollectedRunCase } from './run-types.ts';
import { resolveBenchmarkGarbageCollectionHost } from './benchmark-garbage-collection.ts';

function selected(
    garbageCollection: BenchmarkGarbageCollectionRequest
): readonly { readonly testCase: CollectedRunCase; }[] {
    const original = createCollectedPlan().files[0]?.cases[0];
    if (original === undefined) {
        throw new Error('Missing collected case.');
    }
    return [ {
        testCase: {
            ...original,
            skipReason: null,
            benchmark: { ...definition(), lifecycle: { ...defaultBenchmarkLifecyclePolicy, garbageCollection } }
        }
    } ];
}

export const testNode = suite('benchmark GC host policy', [
    test('preserves existing flags and recognizes GC aliases without duplication', function (scope: TestScope) {
        for (const flag of [ '--expose-gc', '--expose_gc' ]) {
            const original = { kind: 'child', nodeArguments: [ '--cpu-prof', flag ] } as const;
            const resolved = resolveBenchmarkGarbageCollectionHost(original, 'off', selected('after-sample'));
            scope.assert.deepEqual(resolved, original);
            scope.assert.deepEqual(original.nodeArguments, [ '--cpu-prof', flag ]);
        }
        scope.assert.deepEqual(
            resolveBenchmarkGarbageCollectionHost(
                { kind: 'child', nodeArguments: [ '--cpu-prof' ] },
                'off',
                selected('after-sample')
            ),
            { kind: 'child', nodeArguments: [ '--cpu-prof', '--expose-gc' ] }
        );
        return scope.assert.collect();
    }),
    test('rejects conflicting disable aliases only when selected work requests GC', function (scope: TestScope) {
        const prefixes = [ '--no-', '--no_', '--no' ];
        for (const prefix of prefixes) {
            const original = { kind: 'child', nodeArguments: [ `${prefix}expose-gc` ] } as const;
            scope.assert.throws(
                function () {
                    return resolveBenchmarkGarbageCollectionHost(original, 'off', selected('after-sample'));
                },
                {
                    message: 'Requested benchmark garbage collection conflicts with a GC-disable host argument.'
                }
            );
            scope.assert.equal(resolveBenchmarkGarbageCollectionHost(original, 'off', selected('off')), original);
        }
        return scope.assert.collect();
    }),
    test('ignores absent and skipped selected work', function (scope: TestScope) {
        const original = { kind: 'direct' } as const;
        scope.assert.equal(resolveBenchmarkGarbageCollectionHost(original, 'off', []), original);
        const skipped = selected('after-sample').map(function (entry) {
            return {
                testCase: { ...entry.testCase, skipReason: 'planned skip' }
            };
        });
        scope.assert.equal(resolveBenchmarkGarbageCollectionHost(original, 'off', skipped), original);
        return scope.assert.collect();
    })
]);
