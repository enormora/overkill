import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createRunShardHasher,
    workUnitBelongsToShard
} from './run-sharding.ts';
import type { WorkUnitId } from './run-types.ts';

const unit: WorkUnitId = {
    key: 'source/example.test.ts',
    mode: 'file',
    runtimes: [],
    workload: null
};

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-sharding.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run shard hashing is lazy and partitions one-based shard indexes',
            async body(scope: OverkillScope) {
                scope.assert.equal(await createRunShardHasher({ index: 1, total: 1 }), null);

                const hasher = await createRunShardHasher({ index: 1, total: 2 });

                scope.require.defined(hasher);
                scope.assert.notEqual(
                    workUnitBelongsToShard(unit, { index: 1, total: 2 }, hasher),
                    workUnitBelongsToShard(unit, { index: 2, total: 2 }, hasher)
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
