import { suite, test as authoredTest } from '@overkill-dev/test';

import type { TestScope as EngineScope } from '../engine/engine.entry-point.ts';
import { transcriptAssertion } from '../../test-support/transcript-assertion.ts';
import type { TestScope } from './test.entry-point.ts';
import { recordAsyncSink, transcriptUsage, createTranscript } from './interaction-transcript.ts';

type InvalidTranscriptCase = { readonly name: string; readonly check: (scope: EngineScope) => void; };
const invalidCases: readonly InvalidTranscriptCase[] = [ {
    name: 'contains',
    check(scope) {
        scope.assert(transcriptUsage.contains, null, [ 'state' ]);
    }
}, {
    name: 'empty',
    check(scope) {
        scope.assert(transcriptUsage.empty, null);
    }
}, {
    name: 'exactly',
    check(scope) {
        scope.assert(transcriptUsage.exactly, null, []);
    }
}, {
    name: 'inOrder',
    check(scope) {
        scope.assert(transcriptUsage.inOrder, null, [ [ 'state' ] ]);
    }
}, {
    name: 'startsWith',
    check(scope) {
        scope.assert(transcriptUsage.startsWith, null, [ [ 'state' ] ]);
    }
} ];
export const testNode = suite('transcript assertion validation', [
    ...invalidCases.map(function (scenario) {
        return authoredTest(
            `reports an assertion failure for invalid ${scenario.name} subjects`,
            async function (scope: TestScope) {
                const result = await transcriptAssertion(scenario.check);
                scope.assert.equal(result.summary.failed, 1);
                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.partialDeepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
                    kind: 'fail',
                    failures: [ { kind: 'assertion' } ]
                });
                return scope.assert.collect();
            }
        );
    }),
    authoredTest('rejects non-callable asynchronous subscription factories', function (scope: TestScope) {
        scope.assert.throws(function () {
            Reflect.apply(recordAsyncSink, undefined, [ null ]);
        }, { message: 'recordAsyncSink() requires a subscription factory function.' });
        return scope.assert.collect();
    }),
    authoredTest('rejects asynchronous subscriptions without a cleanup function', function (scope: TestScope) {
        scope.assert.throws(function () {
            Reflect.apply(recordAsyncSink, undefined, [ function () {
                return null;
            } ]);
        }, { message: 'recordAsyncSink() subscription factory must return a cleanup function.' });
        return scope.assert.collect();
    }),
    authoredTest('rejects empty ordered transcript sequences as assertion failures', async function (scope: TestScope) {
        const result = await transcriptAssertion(function (inner) {
            const assert: unknown = inner.assert;
            if (typeof assert !== 'function') {
                throw new TypeError('Expected a callable assertion context.');
            }
            Reflect.apply(assert, undefined, [ transcriptUsage.inOrder, createTranscript(), [] ]);
        });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.partialDeepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
            kind: 'fail',
            failures: [ { kind: 'assertion' } ]
        });
        return scope.assert.collect();
    })
]);
