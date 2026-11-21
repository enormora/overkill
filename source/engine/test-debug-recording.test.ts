import { suite, test } from '@overkill-dev/test';

import type { EqualAssertionNode } from '../assertion-protocol/assertions/equality.ts';
import { createDefaultWorkId } from './identity.ts';
import {
    captureDebugModule,
    createDebugAttempt,
    debugAttempts,
    debugBodyCompleted,
    type DebugAttempt
} from './test-debug-recording.ts';

const work = createDefaultWorkId({ file: 'case.test.ts', title: 'case', suite: [], params: null });
const assertion: EqualAssertionNode<'assert'> = {
    actual: 1,
    check: 'equal',
    expected: 1,
    message: null,
    source: 'assert',
    sourceLocations: [ { kind: 'unknown' } ]
};
const moduleObservation = {
    phase: 'load' as const,
    specifier: 'data:text/javascript,export{}',
    resolvedUrl: 'data:text/javascript,export{}',
    atNanoseconds: '0',
    durationMicroseconds: 1
};

function completedAttempt(): DebugAttempt {
    const attempt = createDebugAttempt(work);
    attempt.record('body-start', null);
    attempt.completeBody({ kind: 'returned' });
    attempt.close();
    return attempt;
}

export const testNode = suite('debug recording boundaries', [
    test('drops oversized timeline labels while preserving body completion', function (scope) {
        const attempt = createDebugAttempt(work);
        attempt.assertion({ ...assertion, message: 'x'.repeat(11 * 1024 * 1024) });
        attempt.completeBody({ kind: 'returned' });
        scope.assert.deepEqual({
            dropped: attempt.snapshot().dropped,
            kinds: attempt.snapshot().timeline.map(function (entry) {
                return entry.kind;
            })
        }, { dropped: 1, kinds: [ 'body-end' ] });
        return scope.assert.collect();
    }),
    test('limits recording providers and ignores registration after completion', function (scope) {
        const attempt = createDebugAttempt(work);
        for (let index = 0; index < 101; index += 1) {
            attempt.includeRecording({
                name: 'recording',
                recorded() {
                    return [ 42 ];
                }
            });
        }
        scope.assert.equal(attempt.recordingProviders().length, 100);
        scope.assert.equal(attempt.snapshot().dropped, 1);
        attempt.close();
        attempt.includeRecording({
            name: 'late',
            recorded() {
                throw new Error('Late provider must not run.');
            }
        });
        scope.assert.equal(attempt.recordingProviders().length, 100);
        return scope.assert.collect();
    }),
    test('rejects oversized provider metadata without exhausting later recordings', function (scope) {
        const attempt = createDebugAttempt(work);
        attempt.includeRecording({
            name: 'x'.repeat(11 * 1024 * 1024),
            recorded() {
                return [];
            }
        });
        attempt.includeRecording({
            name: 'retained',
            recorded() {
                return [ 42 ];
            }
        });
        scope.assert.deepEqual(
            attempt.recordingProviders().map(function (provider) {
                return { name: provider.name, values: provider.recorded() };
            }),
            [ { name: 'retained', values: [ 42 ] } ]
        );
        scope.assert.equal(attempt.snapshot().dropped, 1);
        return scope.assert.collect();
    }),
    test('ignores module observation belonging to a different active attempt', function (scope) {
        const attempt = createDebugAttempt(work);
        const other = createDebugAttempt({ ...work, case: { ...work.case, title: 'other' } });
        attempt.record('body-start', null);
        debugAttempts.run(other, function () {
            captureDebugModule(attempt, { ...moduleObservation, start: process.hrtime.bigint() });
        });
        scope.assert.deepEqual(attempt.snapshot().moduleLoads, []);
        return scope.assert.collect();
    }),
    test('a completed attempt ignores late trace evidence', function (scope) {
        const attempt = completedAttempt();
        const snapshot = attempt.snapshot();
        attempt.record('plan', 2);
        attempt.assertion(assertion);
        attempt.completeBody({ kind: 'rejection', reason: 'late' });
        attempt.module(moduleObservation);
        scope.assert.deepEqual(attempt.snapshot(), snapshot);
        return scope.assert.collect();
    }),
    test('oversized module and overlap observations leave space for later evidence', function (scope) {
        const attempt = createDebugAttempt(work);
        attempt.module({ ...moduleObservation, specifier: 'x'.repeat(11 * 1024 * 1024) });
        attempt.overlap({ ...work, case: { ...work.case, title: 'x'.repeat(3 * 1024 * 1024) } });
        attempt.module(moduleObservation);
        const trace = attempt.snapshot();
        scope.assert.deepEqual(trace.moduleLoads, [ moduleObservation ]);
        scope.assert.deepEqual(trace.overlappingWork, []);
        scope.assert.equal(trace.dropped, 2);
        return scope.assert.collect();
    }),
    test('records an interruption when assertion locations are unavailable', function (scope) {
        const attempt = createDebugAttempt(work);
        debugAttempts.run(attempt, function capture() {
            captureDebugModule(attempt, { ...moduleObservation, start: process.hrtime.bigint() });
            attempt.record('body-start', null);
            attempt.assertion(assertion);
            attempt.assertion({
                ...assertion,
                sourceLocations: [ { kind: 'known', file: '', line: null, column: null } ]
            });
            debugBodyCompleted({ kind: 'interrupted' });
        });
        const trace = attempt.snapshot();
        scope.assert.deepEqual(trace.moduleLoads, []);
        scope.assert.deepEqual(
            trace.timeline.slice(1, 3).map(function locations(entry) {
                return entry.sourceLocations;
            }),
            [ [ { kind: 'unknown' } ], [] ]
        );
        scope.assert.partialDeepEqual(trace.timeline.slice(-1), [ {
            kind: 'rejection',
            reason: { kind: 'error', message: 'Test body interrupted before completion.' }
        } ]);
        return scope.assert.collect();
    })
]);
