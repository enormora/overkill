import { workIdentityKey } from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { createSupervisedRunState, type SupervisedRunState } from '../run/supervised-run-state.ts';
import { captureCrashEvidence, captureProcessExhaustionEvidence } from '../run/supervised-run-process-policy.ts';

const terminalDurationMicroseconds = 10;
const splitByteOffset = 2;
const capturedOutputByteLimit = 5;
const outputTimes = { firstChunk: 1, secondChunk: 2, stderr: 3, retryStart: 4, lateStdout: 5, lateStderr: 6 };

export const work = createDefaultWorkId({ file: 'example.test.ts', suite: [], title: 'example', params: null });

export const peer = { ...work, case: { ...work.case, title: 'peer' } };

export const crashedAttempt = { index: 2 };

export const sample = {
    activeResourceCount: 10,
    activeResourceTypes: [ 'Timeout' ],
    capturedAtMicroseconds: 1,
    javaScriptEngineHeapBytes: 100,
    residentSetBytes: 200
};

export function jsonWireValue(value: unknown): unknown {
    const encoded = JSON.stringify(value);
    return JSON.parse(encoded);
}

export function crashedState(): SupervisedRunState {
    const state = createSupervisedRunState('all');
    state.addActiveCase(workIdentityKey(work), { capture: null, id: work.case, workId: work }, 0, crashedAttempt);
    state.recordRunnerError(captureCrashEvidence(state, 'worker exited'));
    state.recordTerminalActiveCases('crashed', terminalDurationMicroseconds);
    state.recordBoundaryFailure({
        kind: 'worker-crash',
        reason: 'process-exit',
        signal: 'SIGSEGV',
        exitCode: null,
        coreDumpPath: null,
        nativeAddons: null
    });
    return state;
}

export function sharedExhaustion(): SupervisedRunState {
    const state = createSupervisedRunState('all');
    state.addActiveCase(workIdentityKey(work), { capture: null, id: work.case, workId: work }, 0, { index: 1 });
    state.addActiveCase(workIdentityKey(peer), { capture: null, id: peer.case, workId: peer }, 0, { index: 3 });
    const error = captureProcessExhaustionEvidence(
        { metric: 'activeResourceCount', budget: 5, observed: 10, sample },
        state,
        null
    );
    state.recordRunnerError(error);
    state.recordRunnerError(captureCrashEvidence(state, 'process killed after exhaustion'));
    return state;
}

function recordSplitUnicode(state: SupervisedRunState): void {
    const bytes = Buffer.from('🌍');
    state.recordCapturedOutput('stdout', bytes.subarray(0, splitByteOffset), outputTimes.firstChunk);
    state.recordCapturedOutput('stdout', bytes.subarray(splitByteOffset), outputTimes.secondChunk);
    state.recordCapturedOutput('stderr', Buffer.from('xy'), outputTimes.stderr);
}

export function capturedRetryOutput(): SupervisedRunState {
    const state = createSupervisedRunState('all', capturedOutputByteLimit);
    state.addActiveCase(workIdentityKey(work), { capture: null, id: work.case, workId: work }, 0, { index: 0 });
    recordSplitUnicode(state);
    state.removeActiveCase(workIdentityKey(work));
    state.addActiveCase(workIdentityKey(work), { capture: null, id: work.case, workId: work }, outputTimes.retryStart, {
        index: 1
    });
    state.recordCapturedOutput('stdout', Buffer.from('discarded'), outputTimes.lateStdout);
    state.recordCapturedOutput('stderr', Buffer.from('discarded again'), outputTimes.lateStderr);
    return state;
}
