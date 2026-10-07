import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';

const emptyTestData = {
    annotations: {},
    controls: {}
};

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-workers.test.ts',
    ...emptyTestData,
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses worker count for run commands',
            ...emptyTestData,
            async body(scope: TestScope) {
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
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects invalid worker counts',
            ...emptyTestData,
            async body(scope: TestScope) {
                for (const workers of [ '0', '-1', '1.5', '9007199254740992' ]) {
                    const result = await runCommandLine([ 'run', '--workers', workers ], passingResult());

                    scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                    scope.assert.equal(result.runRequests.length, 0);
                    scope.assert.true(result.stderr.includes('Worker count must be a positive safe integer:'));
                }

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects worker count for list commands',
            ...emptyTestData,
            async body(scope: TestScope) {
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

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
