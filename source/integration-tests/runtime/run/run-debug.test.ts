import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { passingResult, runCommandLine } from '../../../test-support/command-line-test-driver.ts';

export const testNode = suite('debug requests', [
    test(
        'standalone debug scopes preserve selection and repeated selectors',
        async function (scope: TestScope) {
            const result = await runCommandLine(
                [ 'run', '--debug-scope', 'title=first', '--debug-scope', 'title=second' ],
                passingResult()
            );
            scope.assert.deepEqual(result.exitCodes, [ 0 ]);
            const request = result.runRequests[0]?.runRequest;
            scope.require.defined(request);
            scope.assert.deepEqual(request.debug, { mode: 'selected', selectors: [ 'title=first', 'title=second' ] });
            scope.assert.deepEqual(request.selection, { kind: 'all' });
            return scope.assert.collect();
        }
    ),
    test('debug all is accepted by ordinary and benchmark run commands', async function (scope: TestScope) {
        const ordinary = await runCommandLine([ 'run', '--debug' ], passingResult());
        const benchmark = await runCommandLine([ 'bench', 'run', '--debug' ], passingResult());
        scope.assert.deepEqual(ordinary.exitCodes, [ 0 ]);
        const request = ordinary.runRequests[0];
        scope.require.defined(request);
        scope.assert.deepEqual(request.runRequest.debug, { mode: 'all', selectors: [] });
        scope.assert.deepEqual(benchmark.exitCodes, [ 0 ]);
        return scope.assert.collect();
    }),
    table({
        title: 'reports invalid debug arguments as usage errors',
        cases: [
            [ 'run', '--debug', '--debug-scope', 'title=case' ],
            [ 'run', '--debug-scope', 'invalid' ],
            [ 'run', '--debug-scope', '' ],
            [ 'run', '--debug-scope' ]
        ],
        caseTitle(args) {
            return JSON.stringify(args);
        },
        async test(scope) {
            const args = scope.parameters;

            const result = await runCommandLine(args, passingResult());
            scope.assert.deepEqual(result.exitCodes, [ 3 ]);
            scope.assert.equal(result.runRequests.length, 0);
            return scope.assert.collect();
        }
    })
]);
