import { suite, test } from '@overkill-dev/test';

import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';

export const testNode = suite({
    title: 'Overkill CLI help',

    children: [
        test({
            title: 'prints help without running tests',

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
