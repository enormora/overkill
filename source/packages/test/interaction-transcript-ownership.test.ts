import { suite, test, recordSink, recordAsyncSink, type Transcript, type TestScope } from './test.entry-point.ts';

type Entry = readonly [kind: 'state', value: number];
function assertForwardedTranscript(scope: TestScope, transcript: Transcript<Entry>): void {
    transcript.record('state', 1);
    transcript.sink('state')(2);
    scope.assert.equal(transcript.entryCount, 2);
    scope.assert.deepEqual<unknown, unknown>(transcript.firstEntry, [ 'state', 1 ]);
    scope.assert.deepEqual<unknown, unknown>(transcript.lastEntry, [ 'state', 2 ]);
    scope.assert.deepEqual<unknown, unknown>(transcript.nthEntry(1), [ 'state', 2 ]);
    scope.assert.deepEqual<unknown, unknown>(transcript.entries, [ [ 'state', 1 ], [ 'state', 2 ] ]);
    transcript.reset();
    scope.assert.equal(transcript.entryCount, 0);
    scope.assert.deepEqual({ first: transcript.firstEntry, last: transcript.lastEntry }, { first: null, last: null });
}
export const testNode = suite('disposable transcript ownership', [
    test('preserves transcript operations through a synchronous subscription wrapper', function (scope: TestScope) {
        let disposed = 0;
        using transcript = recordSink<Entry>(function () {
            return function () {
                disposed += 1;
            };
        });
        assertForwardedTranscript(scope, transcript);
        transcript.dispose();
        transcript.dispose();
        scope.assert.equal(disposed, 1);
        return scope.assert.collect();
    }),
    test(
        'preserves transcript operations through an asynchronous subscription wrapper',
        async function (scope: TestScope) {
            let disposed = 0;
            await using transcript = recordAsyncSink<Entry>(function () {
                return async function () {
                    disposed += 1;
                };
            });
            assertForwardedTranscript(scope, transcript);
            await transcript.asyncDispose();
            await transcript.asyncDispose();
            scope.assert.equal(disposed, 1);
            return scope.assert.collect();
        }
    )
]);
