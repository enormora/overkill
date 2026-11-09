import { runIfMain } from '#test-runner';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import {
    createSuite,
    createTestCase,
    defaultFailureArtifactPolicy,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import { createBoundaryFailureArtifact, type BoundaryFailure, type BoundaryMetadata } from '../engine/run-artifact.ts';
import { recordedReplayProfile } from './run-record-input.ts';
import { restoreReplayProfile } from './replay-profile.ts';
import { createSupervisedRunState, type SupervisedRunState } from './supervised-run-state.ts';
import { captureCrashEvidence, captureProcessExhaustionEvidence } from './supervised-run-process-policy.ts';
import { parseRunArtifacts } from './run-artifact-schema.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const work = createDefaultWorkId({ file: 'example.test.ts', suite: [], title: 'example', params: null });
const peer = { ...work, case: { ...work.case, title: 'peer' } };
const crashedAttempt = { index: 2 };
const sample = {
    activeResourceCount: 10,
    activeResourceTypes: [ 'Timeout' ],
    capturedAtMicroseconds: 1,
    javaScriptEngineHeapBytes: 100,
    residentSetBytes: 200
};

function jsonWireValue(value: unknown): unknown {
    const encoded = JSON.stringify(value);
    return JSON.parse(encoded);
}

function crashedState(): SupervisedRunState {
    const state = createSupervisedRunState('all');
    state.addActiveCase(workIdentityKey(work), { capture: null, id: work.case, workId: work }, 0, crashedAttempt);
    state.recordRunnerError(captureCrashEvidence(state, 'worker exited'));
    state.recordTerminalActiveCases('crashed', 10);
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

function sharedExhaustion(): SupervisedRunState {
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
    state.recordCapturedOutput('stdout', bytes.subarray(0, 2), 1);
    state.recordCapturedOutput('stdout', bytes.subarray(2), 2);
    state.recordCapturedOutput('stderr', Buffer.from('xy'), 3);
}

function capturedRetryOutput(): SupervisedRunState {
    const state = createSupervisedRunState('all', 5);
    state.addActiveCase(workIdentityKey(work), { capture: null, id: work.case, workId: work }, 0, { index: 0 });
    recordSplitUnicode(state);
    state.removeActiveCase(workIdentityKey(work));
    state.addActiveCase(workIdentityKey(work), { capture: null, id: work.case, workId: work }, 4, { index: 1 });
    state.recordCapturedOutput('stdout', Buffer.from('discarded'), 5);
    state.recordCapturedOutput('stderr', Buffer.from('discarded again'), 6);
    return state;
}

function assertNativeEvidenceRetention(
    scope: TestScope,
    failure: BoundaryFailure,
    nativeMetadata: BoundaryMetadata
): void {
    const native = createBoundaryFailureArtifact(
        failure,
        nativeMetadata,
        [ { work, attempt: crashedAttempt } ],
        0
    );
    const state = createSupervisedRunState('all');
    state.recordArtifact(native);
    state.recordArtifact(native);
    state.recordBoundaryFailure(failure);
    state.recordBoundaryFailure({
        kind: 'worker-crash',
        reason: 'parent-exit',
        exitCode: 9,
        signal: 'SIGKILL',
        coreDumpPath: 'artifacts/parent-core',
        nativeAddons: [ 'parent.node' ]
    });
    scope.assert.deepEqual(state.artifacts(), [ native ]);
}

export const testNode = createSuite({
    ...metadata,
    title: 'boundary failure artifacts',
    children: [
        createTestCase({
            ...metadata,
            title: 'native completion evidence survives repeated delivery and parent exits',
            body(scope: TestScope) {
                const failures: readonly BoundaryFailure[] = [
                    {
                        kind: 'worker-crash',
                        reason: 'native-exit',
                        exitCode: null,
                        signal: 'SIGSEGV',
                        coreDumpPath: null,
                        nativeAddons: null
                    },
                    {
                        kind: 'process-exhaustion',
                        metric: 'activeResourceCount',
                        budget: 5,
                        observed: 10,
                        enforcement: 'sampled',
                        processUsageSamplingIntervalMilliseconds: 100,
                        samples: [ sample ]
                    }
                ];
                const nativeMetadata: BoundaryMetadata = {
                    source: 'native',
                    workerId: 'worker',
                    nodeVersion: '26.13.0',
                    timestamp: '1970-01-01T00:00:00.000Z'
                };
                for (const failure of failures) {
                    assertNativeEvidenceRetention(scope, failure, nativeMetadata);
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'later exits preserve known crash metadata and original attempt ownership',
            body(scope: TestScope) {
                const state = createSupervisedRunState('all');
                state.addActiveCase(
                    workIdentityKey(work),
                    { capture: null, id: work.case, workId: work },
                    0,
                    crashedAttempt
                );
                state.recordBoundaryFailure({
                    kind: 'worker-crash',
                    reason: 'native-exit',
                    exitCode: 1,
                    signal: 'SIGSEGV',
                    coreDumpPath: 'artifacts/first-core',
                    nativeAddons: [ 'first.node' ]
                });
                state.recordTerminalActiveCases('crashed', 10);
                state.recordBoundaryFailure({
                    kind: 'worker-crash',
                    reason: 'process-exit',
                    exitCode: 2,
                    signal: 'SIGKILL',
                    coreDumpPath: 'artifacts/later-core',
                    nativeAddons: [ 'later.node' ]
                });
                const artifacts = state.artifacts();
                scope.assert.equal(artifacts.length, 1);
                scope.require.defined(artifacts[0]);
                scope.assert.partialDeepEqual(artifacts[0], {
                    id: { scope: { kind: 'case', case: work.case }, attempt: crashedAttempt },
                    payload: {
                        reason: 'native-exit',
                        exitCode: 1,
                        signal: 'SIGSEGV',
                        coreDumpPath: 'artifacts/first-core',
                        nativeAddons: [ 'first.node' ]
                    }
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'replay restores saved diagnostic limits and defaults legacy records',
            body(scope: TestScope) {
                const current = defaultMicrotestProfile();
                const policy = {
                    ...defaultFailureArtifactPolicy,
                    capturedOutputBytes: 17,
                    serialization: { ...defaultFailureArtifactPolicy.serialization, stringBytes: 3 },
                    rendering: { diffLines: 2, valueBytes: 4 }
                };
                const saved = recordedReplayProfile({ ...current, failureArtifacts: policy });
                scope.assert.deepEqual(restoreReplayProfile(jsonWireValue(saved), current).failureArtifacts, policy);
                const legacy = { ...current };
                Reflect.deleteProperty(legacy, 'reporters');
                Reflect.deleteProperty(legacy, 'failureArtifacts');
                const restored = restoreReplayProfile(jsonWireValue(legacy), current);
                scope.assert.deepEqual(restored.failureArtifacts, defaultFailureArtifactPolicy);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'crash evidence retains its owning attempt after active cases are cleared',
            body(scope: TestScope) {
                const state = crashedState();
                scope.assert.equal(state.activeCases.size, 0);
                scope.assert.equal(state.artifacts().length, 1);
                const artifact = state.artifacts()[0];
                scope.require.defined(artifact);
                scope.assert.partialDeepEqual(artifact, {
                    id: { scope: { kind: 'case', case: work.case }, attempt: crashedAttempt, subtype: 'worker-crash' },
                    source: 'boundary-captured',
                    payload: {
                        kind: 'worker-crash',
                        signal: 'SIGSEGV',
                        activeWork: [ { work, attempt: crashedAttempt } ]
                    }
                });
                scope.assert.deepEqual(
                    jsonWireValue(parseRunArtifacts(state.artifacts())),
                    jsonWireValue(state.artifacts())
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'shared exhaustion preserves every active work identity in one run artifact',
            body(scope: TestScope) {
                const state = sharedExhaustion();
                scope.assert.equal(state.artifacts().length, 1);
                scope.assert.equal(state.runnerErrors()[0]?.attributedTo, null);
                const artifact = state.artifacts()[0];
                scope.require.defined(artifact);
                scope.assert.partialDeepEqual(artifact, {
                    id: { scope: { kind: 'run' }, attempt: null, subtype: 'process-exhaustion' },
                    payload: {
                        budget: 5,
                        observed: 10,
                        activeWork: [ { work, attempt: { index: 1 } }, { work: peer, attempt: { index: 3 } } ],
                        samples: [ sample ]
                    }
                });
                scope.assert.deepEqual(
                    jsonWireValue(parseRunArtifacts(state.artifacts())),
                    jsonWireValue(state.artifacts())
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'configured output caps preserve split UTF-8 and stay shared across streams and retries',
            body(scope: TestScope) {
                const artifacts = capturedRetryOutput().artifacts();
                const output = artifacts.flatMap(function captured(artifact) {
                    return artifact.payload.kind === 'captured-output' ? [ artifact.payload ] : [];
                });
                scope.assert.equal(artifacts.length, 4);
                scope.assert.equal(
                    output
                        .map(function capturedText(payload) {
                            return payload.text;
                        })
                        .join(''),
                    '🌍x'
                );
                scope.assert.equal(
                    output.reduce(function capturedBytes(total, payload) {
                        return total + payload.byteLength;
                    }, 0),
                    5
                );
                scope.assert.equal(output.at(-1)?.truncated, true);
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
