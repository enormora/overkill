import { runIfMain } from '#test-runner';
import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-coverage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper carries last-failed through run and list requests',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                const run = await runCommandLine([ 'run', '--last-failed', '--title', 'login' ], passingResult());
                const list = await runCommandLine([ 'list', '--last-failed' ], passingResult());
                const request = run.runRequests[0];
                scope.require.defined(request);
                scope.assert.equal(run.runRequests[0]?.runRequest.lastFailed, true);
                scope.assert.deepEqual(request.runRequest.selection, {
                    kind: 'filter', filter: { kind: 'contains', field: 'title', value: 'login' }
                });
                scope.assert.equal(run.runRequests[0]?.runRequest.record, false);
                scope.assert.equal(list.listRequests[0]?.listRequest.lastFailed, true);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'overkill wrapper requests run records explicitly',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([ 'run', '--record' ], passingResult());
                scope.assert.equal(result.runRequests[0]?.runRequest.record, true);
                scope.assert.equal(result.exitCode, 0);
                const listed = await runCommandLine([ 'list', '--record' ], passingResult());
                scope.assert.equal(listed.exitCode, 3);
                scope.assert.equal(listed.runnerLoadCount, 0);
                return scope.assert.collect();
            }
        }),
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

await runIfMain(import.meta, testNode);
