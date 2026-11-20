import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { managedCase } from '../test-support/managed-resource-acquisition.ts';
import { testNode as cases } from './case-leak-policy.test.ts';
import { activeResourceLeakError, createDisabledAsyncLeakMonitor } from './async-leak-diagnostics.ts';

export const testNode = authoredSuite('async leak diagnostic policy', [
    cases,
    authoredTest('reports sorted increases while ignoring pipe handles', function (scope: TestScope) {
        const testCase = managedCase();
        const error = activeResourceLeakError({
            before: [ 'TCPWRAP' ],
            after: [ 'Timeout', 'TCPWRAP', 'Timeout', 'Immediate', 'PipeWrap' ],
            attributedTo: testCase.id,
            attributedToWork: testCase.workId,
            phase: 'body'
        });
        scope.require.defined(error);
        scope.assert.partialDeepEqual<unknown, unknown>(error, {
            subtype: 'runtime-policy',
            attributedTo: testCase.id,
            cause: { resourceTypes: [ 'Immediate', 'Timeout', 'Timeout' ], phase: 'body', strictness: 'observed' }
        });
        scope.assert.equal(error.attributedToWork, testCase.workId);
        return scope.assert.collect();
    }),
    ...([ { before: [ 'Timeout', 'Timeout' ], after: [ 'Timeout' ] }, { before: [], after: [ 'PipeWrap' ] }, {
        before: [ 'TCPWRAP' ],
        after: [ 'TCPWRAP' ]
    } ] as const)
        .map(function (input, index) {
            return authoredTest(`ignores unchanged and released resources ${index}`, function (scope: TestScope) {
                scope.assert.equal(
                    activeResourceLeakError({ ...input, attributedTo: null, attributedToWork: null, phase: 'run' }),
                    null
                );
                return scope.assert.collect();
            });
        }),
    authoredTest('disabled observation preserves outside-case results and errors', async function (scope: TestScope) {
        const monitor = createDisabledAsyncLeakMonitor();
        scope.assert.equal(
            await monitor.runOutsideCase(async function () {
                return 42;
            }),
            42
        );
        const failure = new Error('outside work failed');
        await scope.assert.rejects(async function () {
            await monitor.runOutsideCase(async function () {
                throw failure;
            });
        }, { exact: failure });
        monitor.stop();
        return scope.assert.collect();
    })
]);
