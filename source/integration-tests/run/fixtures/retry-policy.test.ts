import { test } from '../../../packages/test/test.entry-point.ts';
import { defineResource, withResource } from '../../../packages/test/resources.entry-point.ts';

const retry = defineResource({
    acquire() { return {}; },
    dispose: null,
    name: 'retry',
    requirements: [],
    scope: 'per-case'
});

let attempts = 0;

export const testNode = test('recovers on the third attempt', withResource(retry, async (scope) => {
    attempts += 1;
    const evidence = await scope.attachments.open({ kind: 'text', mediaType: 'text/plain', name: 'retry-evidence' });
    await evidence.write(`retry evidence ${attempts}`);
    await evidence.close();
    await scope.yieldToNextTurn();
    scope.assert.equal(attempts, 3);
    return scope.assert.collect();
}));
