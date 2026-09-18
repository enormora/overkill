import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from './command-line-runner.test.ts';

const emptyTestData = { annotations: {}, controls: {} } as const;

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-help.test.ts',
    ...emptyTestData,
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
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

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
