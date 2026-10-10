import { suite, test, skippedTest } from '../../../packages/bench/bench.entry-point.ts';
import { defineRuntime, withRuntime } from '../../../packages/test/resources.entry-point.ts';

const runtime = defineRuntime({ dimensions: {}, name: 'reference', requirements: [], resources: {} });

export const testNode = suite('performance observations', [
    test('first', withRuntime(runtime, async (scope) => {
        const artifact = await scope.attachments.json({ mediaType: 'application/json', name: 'duration' }, 100);
        scope.assert.equal(artifact.payload.name, 'duration');
        return scope.assert.collect();
    })),
    test('second', withRuntime(runtime, async (scope) => {
        const artifact = await scope.attachments.json({ mediaType: 'application/json', name: 'duration' }, 200);
        scope.assert.equal(artifact.payload.name, 'duration');
        return scope.assert.collect();
    })),
    skippedTest('unavailable', 'fixture unavailable')
]);
