import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
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
    test('a completed attempt ignores late trace evidence', function (scope: TestScope) {
        const attempt = completedAttempt();
        const snapshot = attempt.snapshot();
        attempt.record('plan', 2);
        attempt.assertion(assertion);
        attempt.completeBody({ kind: 'rejection', reason: 'late' });
        attempt.module(moduleObservation);
        scope.assert.deepEqual(attempt.snapshot(), snapshot);
        return scope.assert.collect();
    }),
    test('oversized module and overlap observations leave space for later evidence', function (scope: TestScope) {
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
    test('records an interruption when assertion locations are unavailable', function (scope: TestScope) {
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
await runIfMain(import.meta, testNode);
