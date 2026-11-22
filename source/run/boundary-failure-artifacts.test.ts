import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { defaultFailureArtifactPolicy, workIdentityKey } from '../packages/engine/engine.entry-point.ts';
import { parseRunArtifacts } from '../packages/run/run.entry-point.ts';
import { createBoundaryFailureArtifact, type BoundaryFailure, type BoundaryMetadata } from '../engine/run-artifact.ts';
import {
    work,
    peer,
    crashedAttempt,
    sample,
    jsonWireValue,
    crashedState,
    sharedExhaustion,
    capturedRetryOutput
} from '../test-support/boundary-failure-fixture.ts';
import { recordedReplayProfile } from './run-record-input.ts';
import { restoreReplayProfile } from './replay-profile.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';

const assertNativeEvidenceRetention = defineCompositeAssertion({
    name: 'native evidence retention',
    assert(check, failure: BoundaryFailure, nativeMetadata: BoundaryMetadata) {
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
        return check.group([ check.deepEqual(state.artifacts(), [ native ]) ]);
    }
});

export const testNode = suite('boundary failure artifacts', [
    test('native completion evidence survives repeated delivery and parent exits', function (scope) {
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
            scope.assert(assertNativeEvidenceRetention, failure, nativeMetadata);
        }
        return scope.assert.collect();
    }),
    test('later exits preserve known crash metadata and original attempt ownership', function (scope: TestScope) {
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
    }),
    test('replay restores saved diagnostic limits and defaults legacy records', function (scope) {
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
    }),
    test('crash evidence retains its owning attempt after active cases are cleared', function (scope: TestScope) {
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
    }),
    test('shared exhaustion preserves every active work identity in one run artifact', function (scope: TestScope) {
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
    }),
    test(
        'configured output caps preserve split UTF-8 and stay shared across streams and retries',
        function (scope) {
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
    )
]);
