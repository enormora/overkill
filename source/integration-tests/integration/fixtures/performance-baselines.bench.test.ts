import { suite, test, skippedTest } from '@overkill-dev/test/bench';
import { defineRuntime, withRuntime } from '@overkill-dev/test/resources';

const runtime = defineRuntime({ dimensions: {}, name: 'reference', requirements: [], resources: {} });

export const testNode = suite('performance observations', [
    test(
        'first',
        withRuntime(runtime, async (scope) => {
            const artifact = await scope.attachments.json({ mediaType: 'application/json', name: 'duration' }, 100);
            scope.assert.equal(artifact.payload.name, 'duration');
            return scope.assert.collect();
        })
    ),
    test(
        'second',
        withRuntime(runtime, async (scope) => {
            const artifact = await scope.attachments.json({ mediaType: 'application/json', name: 'duration' }, 200);
            scope.assert.equal(artifact.payload.name, 'duration');
            return scope.assert.collect();
        })
    ),
    skippedTest('unavailable', 'fixture unavailable')
]);
