import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from './command-line-runner.test.ts';

const emptyTestData = { annotations: {}, controls: {} } as const;

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-sharding.test.ts',
    ...emptyTestData,
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses run shards',
            ...emptyTestData,
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', '--shard=2/3', 'source/a.test.ts' ], passingResult());

                scope.require.defined(result.runRequests[0]);
                scope.assert.deepEqual(result.runRequests[0].runRequest.shard, { index: 2, total: 3 });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
