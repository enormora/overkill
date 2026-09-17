import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import type { CollectedRunCaseEntry } from './collected-run-plan.ts';
import {
    createRunShardHasher,
    type RunShardHasher,
    shardCollectedRunCaseEntries,
    shardCollectedRunPlanCases,
    workUnitBelongsToShard
} from './run-sharding.ts';
import type { CollectedRunPlan, WorkUnitId } from './run-types.ts';

const unit: WorkUnitId = {
    key: 'source/example.test.ts',
    mode: 'file',
    runtimes: [],
    workload: null
};
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
const definitionLocations = [ { kind: 'unknown' as const } ] as const;
const resourceAttachments = {
    directResources: [],
    resourceGraph: [],
    runtimeGraphs: []
};

function createRecordingHasher(result: bigint): {
    readonly hasher: RunShardHasher;
    readonly values: () => readonly string[];
} {
    const values: string[] = [];

    return {
        hasher: {
            hash(value) {
                values.push(value);

                return result;
            }
        },
        values() {
            return values;
        }
    };
}

function runCaseEntry(title: string): CollectedRunCaseEntry {
    const id = createCaseId('source/example.test.ts', [], title, null);
    const workId = createDefaultWorkId(id);

    return {
        file: 'source/example.test.ts',
        id,
        testCase: {
            annotations,
            controls,
            definitionLocations,
            params: null,
            resourceAttachments,
            suitePath: [],
            testFamily: 'microtest',
            title,
            workId
        },
        workId
    };
}

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
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run shard hashing canonicalizes work-unit identity before hashing',
            body(scope: OverkillScope) {
                const recording = createRecordingHasher(1n);
                const decomposedAccent = 'Cafe\u{301}';
                const richUnit = {
                    key: decomposedAccent,
                    mode: 'case',
                    runtime: {
                        dimensions: {
                            z: 'last',
                            a: decomposedAccent
                        },
                        enabled: true,
                        list: [ false, null, 7, decomposedAccent ],
                        name: 'node',
                        variantId: null
                    },
                    workload: {
                        name: 'load',
                        params: {
                            beta: '2',
                            alpha: decomposedAccent
                        }
                    }
                } as unknown as WorkUnitId;

                scope.assert.equal(
                    workUnitBelongsToShard(richUnit, { index: 2, total: 4 }, recording.hasher),
                    true
                );
                scope.assert.deepEqual(recording.values(), [
                    '{"key":"Café","mode":"case","runtime":{"dimensions":{"a":"Café","z":"last"},"enabled":true,"list":[false,null,7,"Café"],"name":"node","variantId":null},"workload":{"name":"load","params":{"alpha":"Café","beta":"2"}}}'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run shard hashing rejects sharded checks without a hasher',
            body(scope: OverkillScope) {
                scope.assert.throws(function shardWithoutHasher() {
                    workUnitBelongsToShard(unit, { index: 1, total: 2 }, null);
                }, {
                    message: 'Sharded planning requires a shard hasher.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run shard hashing rejects noncanonical identity values',
            body(scope: OverkillScope) {
                scope.assert.throws(function shardInvalidNumberIdentity() {
                    workUnitBelongsToShard(
                        {
                            ...unit,
                            invalid: Number.NaN
                        } as unknown as WorkUnitId,
                        { index: 1, total: 2 },
                        createRecordingHasher(0n).hasher
                    );
                }, {
                    message: 'Cannot serialize number value for shard partitioning.'
                });
                scope.assert.throws(function shardInvalidUndefinedIdentity() {
                    workUnitBelongsToShard(
                        {
                            ...unit,
                            invalid: undefined
                        } as unknown as WorkUnitId,
                        { index: 1, total: 2 },
                        createRecordingHasher(0n).hasher
                    );
                }, {
                    message: 'Cannot serialize undefined value for shard partitioning.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run shard filtering keeps collected cases assigned to the shard',
            body(scope: OverkillScope) {
                const first = runCaseEntry('first');
                const second = runCaseEntry('second');
                const hasher: RunShardHasher = {
                    hash(value) {
                        return value.includes('second') ? 1n : 0n;
                    }
                };
                const plan: CollectedRunPlan = {
                    defined: 2,
                    discoveredFiles: [
                        {
                            cases: [ first.testCase, second.testCase ],
                            file: first.file
                        }
                    ],
                    files: [
                        {
                            cases: [ first.testCase, second.testCase ],
                            file: first.file
                        }
                    ],
                    orphans: [],
                    root: {
                        annotations,
                        controls,
                        title: 'root'
                    }
                };

                scope.assert.deepEqual(
                    shardCollectedRunCaseEntries([ first, second ], { index: 1, total: 2 }, hasher),
                    [ first ]
                );
                scope.assert.deepEqual(
                    shardCollectedRunPlanCases(plan, { index: 2, total: 2 }, hasher).map(function toTitle(entry) {
                        return entry.testCase.title;
                    }),
                    [ 'second' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
