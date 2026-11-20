import { type TestNode, table, suite, test } from '@overkill-dev/test';
import type { EngineCaseBody } from '../../test-support/create-test-engine.ts';

import { transcriptAssertion } from '../../test-support/transcript-assertion.ts';

import { recordAsyncSink, transcriptUsage, createTranscript } from './interaction-transcript.ts';

type InvalidTranscriptCase = {
    readonly name: string;
    readonly check: (...parameters: Parameters<EngineCaseBody>) => void;
};
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
export const testNode: TestNode = suite('transcript assertion validation', [
    table({
        title: 'reports invalid transcript subjects as assertion failures',
        cases: invalidCases,
        caseTitle(scenario) {
            return `${scenario.name}`;
        },
        async test(scope) {
            const scenario = scope.parameters;

            const result = await transcriptAssertion(scenario.check);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.partialDeepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
                kind: 'fail',
                failures: [ { kind: 'assertion' } ]
            });
            return scope.assert.collect();
        }
    }),
    test('rejects non-callable asynchronous subscription factories', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(recordAsyncSink, undefined, [ null ]);
        }, { message: 'recordAsyncSink() requires a subscription factory function.' });
        return scope.assert.collect();
    }),
    test('rejects asynchronous subscriptions without a cleanup function', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(recordAsyncSink, undefined, [ function () {
                return null;
            } ]);
        }, { message: 'recordAsyncSink() subscription factory must return a cleanup function.' });
        return scope.assert.collect();
    }),
    test('rejects empty ordered transcript sequences as assertion failures', async function (scope) {
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
