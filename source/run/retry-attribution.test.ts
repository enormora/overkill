import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId, workIdentityKey, type WorkId } from '../engine/identity.ts';
import { singleAttemptResult, type TestVerdict } from '../engine/run-result.ts';
import { createSupervisedRunState, type SupervisedRunState } from './supervised-run-state.ts';
import { capturedOutputLimitBytes } from './supervised-output-capture.ts';
import type { RetryArtifactPolicy } from './run-execution-config.ts';
import { crashError } from './supervised-run-resource-policy.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const work = createDefaultWorkId({ file: 'retry.test.ts', params: null, suite: [], title: 'retry' });
const policies: readonly RetryArtifactPolicy[] = [ 'first-failure-and-final', 'last-failure-and-final', 'all' ];
const expectedArtifactAttempts: Readonly<Record<RetryArtifactPolicy, readonly (number | null)[]>> = {
    'first-failure-and-final': [ 0, 2, null ],
    'last-failure-and-final': [ 1, 2, null ],
    all: [ 0, 1, 2, null ]
};

function startAttempt(state: SupervisedRunState, selected: WorkId, index: number): void {
    state.addActiveCase(
        workIdentityKey(selected),
        {
            capture: 'buffered',
            definitionLocations: metadata.definitionLocations,
            id: selected.case,
            workId: selected
        },
        index * 10,
        { index }
    );
}

function finishAttempt(state: SupervisedRunState, index: number, verdict: TestVerdict): void {
    const result = singleAttemptResult({
        definitionLocations: metadata.definitionLocations,
        id: work.case,
        workId: work,
        outcome: null,
        verdict,
        durationMicroseconds: 10
    }, { index });
    state.recordTestAttemptResult(
        workIdentityKey(work),
        result,
        verdict === 'pass' ? 'final' : 'retry',
        (index + 1) * 10
    );
    state.removeActiveCase(workIdentityKey(work));
}

function captureAttempts(state: SupervisedRunState): void {
    for (const index of [ 0, 1, 2 ]) {
        startAttempt(state, work, index);
        state.recordCapturedOutput('stdout', Buffer.from(`attempt ${index}`), index * 10);
        finishAttempt(state, index, index === 2 ? 'pass' : 'fail');
    }
}

function assertCaptureSizes(scope: TestScope, state: SupervisedRunState): void {
    const sizes = state.artifacts().map(function byteCount(artifact) {
        return artifact.payload.kind === 'captured-output'
            ? [ artifact.id.attempt?.index, artifact.payload.byteLength, artifact.payload.truncated ]
            : [];
    });
    scope.assert.deepEqual(sizes, [ [ 0, capturedOutputLimitBytes - 3, false ], [ 1, 3, true ], [ 2, 0, true ] ]);
}

function assertActiveAttempt(scope: TestScope, state: SupervisedRunState): void {
    const attempt = crashError(state, 'killed').attributedToAttempt;
    scope.require.defined(attempt);
    scope.assert.deepEqual(attempt, { index: 1 });
}

function assertTerminalHistory(scope: TestScope, state: SupervisedRunState): void {
    const result = state.perTestResults()[0];
    scope.require.defined(result);
    scope.assert.deepEqual(
        result.attempts.map(function verdict(attempt) {
            return [ attempt.attempt.index, attempt.verdict ];
        }),
        [ [ 0, 'fail' ], [ 1, 'crashed' ] ]
    );
    scope.assert.equal(result.durationMicroseconds, 25);
    scope.assert.equal(result.retried?.finalVerdict, 'crashed');
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/run/retry-attribution.test.ts',
    children: [
        ...policies.map(function retentionPolicy(policy) {
            return createTestCase({
                ...metadata,
                title: `capture retains ${policy} without losing attempt history`,
                body(scope: TestScope) {
                    const state = createSupervisedRunState(policy);
                    captureAttempts(state);
                    state.recordCapturedOutput('stderr', Buffer.from('run output'), 40);
                    const indexes = state.artifacts().map(function attempt(artifact) {
                        return artifact.id.attempt?.index ?? null;
                    });
                    scope.assert.deepEqual(
                        indexes,
                        expectedArtifactAttempts[policy]
                    );
                    scope.assert.equal(state.perTestResults()[0]?.attempts.length, 3);
                    scope.assert.equal(state.perTestResults()[0]?.durationMicroseconds, 30);
                    scope.assert.equal(state.perTestResults()[0]?.verdict, 'pass');
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...metadata,
            title: 'output cap is cumulative across retry attempts',
            body(scope: TestScope) {
                const state = createSupervisedRunState('all');
                for (const [ index, bytes ] of [ [ 0, capturedOutputLimitBytes - 3 ], [ 1, 6 ], [ 2, 2 ] ] as const) {
                    startAttempt(state, work, index);
                    state.recordCapturedOutput('stdout', Buffer.alloc(bytes), index * 10);
                    finishAttempt(state, index, index === 2 ? 'pass' : 'fail');
                }
                assertCaptureSizes(scope, state);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'concurrent output lookup distinguishes runtime variants and attempts',
            body(scope: TestScope) {
                const state = createSupervisedRunState('all');
                const first: WorkId = {
                    ...work,
                    runtimes: [ { name: 'service', variantId: 'one', dimensions: {}, scenarios: {} } ]
                };
                const second: WorkId = {
                    ...work,
                    runtimes: [ { name: 'service', variantId: 'two', dimensions: {}, scenarios: {} } ]
                };
                startAttempt(state, first, 0);
                startAttempt(state, second, 1);
                state.recordCapturedOutput('stdout', Buffer.from('shared'), 0);
                scope.assert.equal(state.caseArtifacts(first, { index: 0 }).length, 1);
                scope.assert.equal(state.caseArtifacts(second, { index: 1 }).length, 1);
                scope.assert.equal(state.caseArtifacts(first, { index: 1 }).length, 0);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'crashed retries preserve completed attempts and active attempt attribution',
            body(scope: TestScope) {
                const state = createSupervisedRunState('all');
                startAttempt(state, work, 0);
                finishAttempt(state, 0, 'fail');
                startAttempt(state, work, 1);
                assertActiveAttempt(scope, state);
                state.recordTerminalActiveCases('crashed', 25);
                assertTerminalHistory(scope, state);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'interruption between attempts preserves the completed retry evidence',
            body(scope: TestScope) {
                const state = createSupervisedRunState('all');
                startAttempt(state, work, 0);
                finishAttempt(state, 0, 'fail');
                state.recordTerminalActiveCases('crashed', 25);
                scope.assert.equal(state.perTestResults()[0]?.attempts.length, 1);
                scope.assert.equal(state.perTestResults()[0]?.verdict, 'fail');
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
