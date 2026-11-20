import { type TestScope, suite as authoredSuite, test, testDouble } from '@overkill-dev/test';

import { observationCase } from '../test-support/observation-lifetime.ts';
import type { BenchmarkScope } from '../engine/benchmark-node.ts';
import { defaultMeasurementTarget } from './measurement-target.ts';
import { createBenchmarkGarbageCollection } from './benchmark-garbage-collection.ts';

function collectionScope(scope: TestScope): BenchmarkScope {
    return {
        workId: observationCase().workId,
        attemptId: { index: 0 },
        workload: { name: 'one', params: {} },
        signal: scope.signal,
        cleanup: scope.cleanup,
        benchmarkEnvironment: null,
        reportError: testDouble.throws(new Error('Unexpected report.')),
        reportCleanupError: testDouble.throws(new Error('Unexpected cleanup report.')),
        updateResult: testDouble.rejects(new Error('Unexpected update.'))
    };
}
const lifecycle = { warmupSamples: 0, cooldown: { mode: 'off' as const }, garbageCollection: 'after-sample' as const };
export const testNode = authoredSuite('garbage collection capability policy', [
    test('rejects unavailable collection capability', async function (scope: TestScope) {
        const target = {
            ...defaultMeasurementTarget(),
            garbageCollection: { kind: 'unavailable' as const, reason: 'not available' }
        };
        const collection = createBenchmarkGarbageCollection({ scope: collectionScope(scope), lifecycle }, target);
        scope.assert.throws(collection.validate, { message: 'not available' });
        await scope.assert.rejects(collection.collect, { message: 'not available' });
        scope.assert.deepEqual(collection.snapshot(), { mode: 'after-sample', completed: 0, failures: 0 });
        return scope.assert.collect();
    }),
    test('counts successful explicit collections', async function (scope: TestScope) {
        const run = testDouble.returns(undefined);
        const target = { ...defaultMeasurementTarget(), garbageCollection: { kind: 'available' as const, run } };
        const collection = createBenchmarkGarbageCollection({ scope: collectionScope(scope), lifecycle }, target);
        collection.validate();
        await collection.collect();
        await collection.collect();
        scope.assert.equal(run.callCount, 2);
        scope.assert.deepEqual(collection.snapshot(), { mode: 'after-sample', completed: 2, failures: 0 });
        return scope.assert.collect();
    }),
    test('counts failed collection without counting completion', async function (scope: TestScope) {
        const target = {
            ...defaultMeasurementTarget(),
            garbageCollection: { kind: 'available' as const, run: testDouble.throws(new Error('native failure')) }
        };
        const collection = createBenchmarkGarbageCollection({ scope: collectionScope(scope), lifecycle }, target);
        await scope.assert.rejects(collection.collect, { message: 'Benchmark garbage collection failed.' });
        scope.assert.deepEqual(collection.snapshot(), { mode: 'after-sample', completed: 0, failures: 1 });
        return scope.assert.collect();
    }),
    test('skips collection after cancellation', async function (scope: TestScope) {
        const controller = new AbortController();
        controller.abort();
        const run = testDouble.throws(new Error('Cancelled collection must not run.'));
        const target = { ...defaultMeasurementTarget(), garbageCollection: { kind: 'available' as const, run } };
        const input = { ...collectionScope(scope), signal: controller.signal };
        const collection = createBenchmarkGarbageCollection({ scope: input, lifecycle }, target);
        await collection.collect();
        scope.assert.deepEqual(collection.snapshot(), { mode: 'after-sample', completed: 0, failures: 0 });
        return scope.assert.collect();
    })
]);
