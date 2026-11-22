import { test } from '@overkill-dev/test';

import { snapshot } from '@overkill-dev/test/baselines';

export const testNode = test('content snapshots', async function (scope) {
    scope.plan(3);
    await scope.assert(snapshot.text, 'response', 'original');
    await scope.assert(snapshot.value, 'record', { active: true, values: [ 1, 2 ] });
    await scope.assert(snapshot.bytes, 'bytes', new Uint8Array([ 0, 127, 255 ]));
    return scope.assert.collect();
});
