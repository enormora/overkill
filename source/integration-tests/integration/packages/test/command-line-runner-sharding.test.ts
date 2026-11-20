import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import { passingResult, runCommandLine } from '../../../../test-support/command-line-test-driver.ts';

const emptyTestData = { annotations: {}, controls: {} } as const;

export const testNode: TestNode = suite({
    title: 'Overkill CLI sharding',
    ...emptyTestData,
    children: [
        test({
            title: 'parses run shards',
            ...emptyTestData,
            async body(
                scope: {
                    readonly assert: Pick<TestScope['assert'], 'deepEqual' | 'collect'>;
                    readonly require: Pick<TestScope['require'], 'defined'>;
                }
            ) {
                const result = await runCommandLine([ 'run', '--shard=2/3', 'source/a.test.ts' ], passingResult());

                scope.require.defined(result.runRequests[0]);
                scope.assert.deepEqual(result.runRequests[0].runRequest.shard, { index: 2, total: 3 });

                return scope.assert.collect();
            }
        })
    ]
});
