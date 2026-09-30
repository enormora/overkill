import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from './command-line-runner.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-coverage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper activates coverage only when requested',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                const defaultResult = await runCommandLine([ 'run', 'source/a.test.ts' ], passingResult());
                const coverageResult = await runCommandLine(
                    [ 'run', '--coverage', 'source/a.test.ts' ],
                    passingResult()
                );
                const [ defaultRequest ] = defaultResult.runRequests;
                const [ coverageRequest ] = coverageResult.runRequests;

                scope.require.defined(defaultRequest);
                scope.require.defined(coverageRequest);
                scope.assert.equal(defaultRequest.runRequest.coverage, false);
                scope.assert.equal(coverageRequest.runRequest.coverage, true);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper rejects coverage for list commands',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                const result = await runCommandLine(
                    [ 'list', '--coverage', 'source/a.test.ts' ],
                    passingResult()
                );

                scope.assert.deepEqual(result.exitCodes, [ 3 ]);
                scope.assert.equal(result.listRequests.length, 0);
                scope.assert.equal(result.stdout, '');
                scope.assert.true(result.stderr.includes('Unknown arguments'));
                scope.assert.true(result.stderr.includes('--coverage'));

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
