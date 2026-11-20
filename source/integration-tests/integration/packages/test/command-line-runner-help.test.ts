import { type TestNode, suite, test } from '@overkill-dev/test';

import { passingResult, runCommandLine } from '../../../../test-support/command-line-test-driver.ts';

const emptyTestData = { annotations: {}, controls: {} } as const;

export const testNode: TestNode = suite({
    title: 'Overkill CLI help',
    ...emptyTestData,
    children: [
        test({
            title: 'prints help without running tests',
            ...emptyTestData,
            async body(
                scope
            ) {
                const result = await runCommandLine([ '--help' ], passingResult());

                scope.assert.deepEqual(result.exitCodes, [ 0 ]);
                scope.assert.equal(result.runRequests.length, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.true(result.stdout.includes('overkill <subcommand>'));

                return scope.assert.collect();
            }
        })
    ]
});
