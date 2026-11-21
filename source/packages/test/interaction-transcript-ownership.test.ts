import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import { recordSink, recordAsyncSink, type Transcript } from './test.entry-point.ts';

type Entry = readonly [kind: 'state', value: number];
const assertForwardedTranscript = defineCompositeAssertion({
    name: 'forwarded transcript',
    assert(check, transcript: Transcript<Entry>) {
        transcript.record('state', 1);
        transcript.sink('state')(2);
        const initialChecks = check.group([
            check.equal(transcript.entryCount, 2),
            check.deepEqual<unknown, unknown>(transcript.firstEntry, [ 'state', 1 ]),
            check.deepEqual<unknown, unknown>(transcript.lastEntry, [ 'state', 2 ]),
            check.deepEqual<unknown, unknown>(transcript.nthEntry(1), [ 'state', 2 ]),
            check.deepEqual<unknown, unknown>(transcript.entries, [ [ 'state', 1 ], [ 'state', 2 ] ])
        ]);
        transcript.reset();
        return check.group([
            initialChecks,
            check.equal(transcript.entryCount, 0),
            check.deepEqual({ first: transcript.firstEntry, last: transcript.lastEntry }, { first: null, last: null })
        ]);
    }
});
export const testNode = suite('disposable transcript ownership', [
    test('preserves transcript operations through a synchronous subscription wrapper', function (scope) {
        let disposed = 0;
        using transcript = recordSink<Entry>(function () {
            return function () {
                disposed += 1;
            };
        });
        scope.assert(assertForwardedTranscript, transcript);
        transcript.dispose();
        transcript.dispose();
        scope.assert.equal(disposed, 1);
        return scope.assert.collect();
    }),
    test(
        'preserves transcript operations through an asynchronous subscription wrapper',
        async function (scope) {
            let disposed = 0;
            await using transcript = recordAsyncSink<Entry>(function () {
                return async function () {
                    disposed += 1;
                };
            });
            scope.assert(assertForwardedTranscript, transcript);
            await transcript.asyncDispose();
            await transcript.asyncDispose();
            scope.assert.equal(disposed, 1);
            return scope.assert.collect();
        }
    )
]);
