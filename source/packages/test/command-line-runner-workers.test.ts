import { suite, test, type TestScope } from '@overkill-dev/test';

import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';

export const testNode = suite({
    title: 'Overkill CLI workers',

    children: [
        test({
            title: 'parses worker count for run commands',

            async body(
                scope: TestScope
            ) {
                const result = await runCommandLine(
                    [ 'run', '--workers', '4', 'source/a.test.ts' ],
                    passingResult()
                );
                const [ commandLineRequest ] = result.runRequests;

                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.runRequest.workers, 4);

                return scope.assert.collect();
            }
        }),
        test({
            title: 'rejects invalid worker counts',

            async body(
                scope
            ) {
                for (const workers of [ '0', '-1', '1.5', '9007199254740992' ]) {
                    const result = await runCommandLine([ 'run', '--workers', workers ], passingResult());

                    scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                    scope.assert.equal(result.runRequests.length, 0);
                    scope.assert.true(result.stderr.includes('Worker count must be a positive safe integer:'));
                }

                return scope.assert.collect();
            }
        }),
        test({
            title: 'rejects worker count for list commands',

            async body(
                scope
            ) {
                const result = await runCommandLine([ 'list', '--workers', '2' ], passingResult());

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.listRequests.length, 0);
                scope.assert.true(result.stderr.includes('Unknown arguments'));
                scope.assert.true(result.stderr.includes('--workers'));

                return scope.assert.collect();
            }
        })
    ]
});
