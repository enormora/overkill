import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from './command-line-runner.test.ts';

const emptyTestData = {
    annotations: {},
    controls: {}
};

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-timings.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper parses run timings flag',
            ...emptyTestData,
            async body(scope: TestScope) {
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
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects timings flag for list',
            ...emptyTestData,
            async body(scope: TestScope) {
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
