import { passingResult, runCommandLine } from '../../test-support/command-line-test-driver.ts';
import { suite, test, type TestScope } from './test.entry-point.ts';

export const testNode = suite('ordinary baseline CLI', [
    test('parses executing verbs with ordinary run selection and lifecycle flags', async function (scope: TestScope) {
        for (const verb of [ 'apply', 'bootstrap', 'diff', 'update' ]) {
            const result = await runCommandLine([
                'baseline',
                verb,
                'source/output.test.ts',
                '--profile',
                'unit',
                '--title',
                'first',
                '--record',
                '--timings'
            ], passingResult());
            const [ execution ] = result.baselineExecutionRequests;
            scope.require.defined(execution);
            scope.assert.equal(execution.verb, verb);
            scope.assert.partialDeepEqual(execution.request.runRequest, {
                profile: 'unit',
                paths: [ 'source/output.test.ts' ],
                record: true,
                timingCollection: 'precise'
            });
            scope.assert.equal(result.runRequests.length, 0);
        }
        return scope.assert.collect();
    }),
    test('lists on disk with profile and paths while rejecting execution flags', async function (scope: TestScope) {
        const listed = await runCommandLine([ 'baseline', 'list', 'source', '--profile', 'unit' ], passingResult());
        scope.assert.equal(listed.baselineExecutionRequests.length, 0);
        scope.assert.deepEqual(
            listed.baselineListRequests.map(function selection(request) {
                return request.listRequest;
            }),
            [ { paths: [ 'source' ], profile: 'unit' } ]
        );
        const invalid = await runCommandLine([ 'baseline', 'list', '--title', 'first' ], passingResult());
        scope.assert.equal(invalid.baselineListRequests.length, 0);
        scope.assert.equal(invalid.exitCode, 3);
        return scope.assert.collect();
    })
]);
