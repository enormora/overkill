import { test } from '../../../packages/test/test.entry-point.ts';
import { snapshot } from '../../../packages/test/baselines.entry-point.ts';

export const testNode = test('content snapshots', async function (scope) {
    scope.plan(3);
    await scope.assert(snapshot.text, 'response', 'original');
    await scope.assert(snapshot.value, 'record', { active: true, values: [ 1, 2 ] });
    await scope.assert(snapshot.bytes, 'bytes', new Uint8Array([ 0, 127, 255 ]));
    return scope.assert.collect();
});
