import { suite, test } from '@overkill-dev/test';

import type { TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';

const emptyTestData = { annotations: {}, controls: {} } as const;

export const testNode = suite({
    title: 'source/packages/test/command-line-runner-help.test.ts',
    ...emptyTestData,
    children: [
        test({
            title: 'overkill wrapper prints help without running tests',
            ...emptyTestData,
            async body(scope: TestScope) {
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
