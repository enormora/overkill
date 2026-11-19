import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { createRunShardHasher, workUnitBelongsToShard } from './run-sharding.ts';
import type { WorkUnitId } from './run-types.ts';

const unit: WorkUnitId = {
    familyVariant: null,
    key: 'source/example.test.ts',
    mode: 'file',
    runtimes: [],
    workload: null
};

export const testNode = suite('native shard hashing integration', [
    test('run shard hashing is lazy and partitions one-based shard indexes', async function (scope: OverkillScope) {
        scope.assert.equal(await createRunShardHasher({ index: 1, total: 1 }), null);

        const hasher = await createRunShardHasher({ index: 1, total: 2 });

        scope.require.defined(hasher);
        scope.assert.notEqual(
            workUnitBelongsToShard(unit, { index: 1, total: 2 }, hasher),
            workUnitBelongsToShard(unit, { index: 2, total: 2 }, hasher)
        );

        return scope.assert.collect();
    })
]);
