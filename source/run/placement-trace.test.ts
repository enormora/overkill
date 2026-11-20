import { type TestNode, suite, test } from '@overkill-dev/test';

import { createPlacementTraceRecorder } from './placement-trace.ts';

const work = {
    familyVariant: null,
    case: { file: 'example.test.ts', params: null, suite: [], title: 'example' },
    runtimes: [],
    workload: null
};
const unit = { familyVariant: null, key: 'example', mode: 'case' as const, runtimes: [], workload: null };
const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

export const testNode: TestNode = suite({
    ...testCaseMetadata,
    title: 'Placement trace',
    children: [
        test({
            ...testCaseMetadata,
            title: 'records a complete immutable attempt lifecycle',
            body(
                scope
            ) {
                const recorder = createPlacementTraceRecorder();
                const attempt = recorder.assignAttempt(unit, [ work ], 'lane-1', { kind: 'initial' });

                recorder.startAttempt(attempt, '1:1');
                recorder.completeAttempt(attempt, 17);
                const trace = recorder.finish();

                scope.assert.deepEqual(
                    trace.entries.map(function toKind(entry) {
                        return entry.kind;
                    }),
                    [ 'attempt-assigned', 'attempt-started', 'attempt-completed' ]
                );
                scope.assert.equal(Object.isFrozen(trace), true);
                scope.assert.equal(Object.isFrozen(trace.entries), true);
                scope.assert.throws(function writeAfterFinish() {
                    recorder.recordDecision({
                        activeAttempt: null,
                        kind: 'worker-crashed',
                        lane: 'lane-1',
                        workerId: null
                    });
                }, { message: 'Placement trace is already finished.' });

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'validates attempt transitions and explicit recovery',
            body(scope) {
                const recorder = createPlacementTraceRecorder();
                const attempt = recorder.assignAttempt(unit, [ work ], 'lane-1', { kind: 'initial' });

                recorder.interruptAttempt(attempt, 'worker-crash');
                recorder.decideRecovery(attempt, 'worker-crash', { kind: 'retry', retryWork: [ work ] });
                scope.assert.throws(function startInterruptedAttempt() {
                    recorder.startAttempt(attempt, '1:1');
                }, { message: `Placement attempt ${attempt} is not assigned.` });
                scope.assert.deepEqual(
                    recorder.finish().entries.map(function toKind(entry) {
                        return entry.kind;
                    }),
                    [ 'attempt-assigned', 'attempt-interrupted', 'recovery-decided' ]
                );

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'rejects unfinished attempts',
            body(scope) {
                const recorder = createPlacementTraceRecorder();
                const attempt = recorder.assignAttempt(unit, [ work ], 'lane-1', { kind: 'initial' });

                scope.assert.throws(function finishUnfinishedAttempt() {
                    recorder.finish();
                }, { message: `Placement attempt ${attempt} is not terminal.` });

                return scope.assert.collect();
            }
        })
    ]
});
