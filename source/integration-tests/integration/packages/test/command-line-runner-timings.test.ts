import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import { passingResult, runCommandLine } from '../../../../test-support/command-line-test-driver.ts';

export const testNode: TestNode = suite({
    title: 'Overkill CLI timings',
    children: [
        test({
            title: 'parses run timings flag',

            async body(
                scope: TestScope
            ) {
                const result = await runCommandLine(
                    [ 'run', '--timings', 'source/a.test.ts' ],
                    passingResult()
                );
                const [ commandLineRequest ] = result.runRequests;

                scope.require.defined(commandLineRequest);
                scope.assert.equal(commandLineRequest.runRequest.timingCollection, 'precise');

                return scope.assert.collect();
            }
        }),
        test({
            title: 'rejects timings flag for list',

            async body(
                scope
            ) {
                const result = await runCommandLine(
                    [ 'list', '--timings', 'source/a.test.ts' ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.listRequests.length, 0);
                scope.assert.equal(result.stdout, '');
                scope.assert.true(result.stderr.includes('Unknown arguments'));
                scope.assert.true(result.stderr.includes('--timings'));

                return scope.assert.collect();
            }
        })
    ]
});
