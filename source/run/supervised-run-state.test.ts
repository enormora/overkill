import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';
import type { ReporterEvent } from '../engine/reporter.ts';

import {
    serializeValue,
    type PropertyCaseEvidence,
    type PerTestResult,
    type PropertyFailureObservation
} from '../packages/engine/engine.entry-point.ts';
import { caseIdentityKey, createDefaultWorkId, workIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createSupervisedRunState, type SupervisedRunState, type SupervisedCase } from './supervised-run-state.ts';
import { applyEvent } from './supervised-run-runtime.ts';
import { capturedOutputLimitBytes } from './supervised-output-capture.ts';

type RunArtifact = ReturnType<SupervisedRunState['artifacts']>[number];
type CapturedOutputPayload = Extract<RunArtifact['payload'], { readonly kind: 'captured-output'; }>;
type CapturedOutputArtifact = RunArtifact & { readonly payload: CapturedOutputPayload; };

function caseId(title: string): CaseId {
    return {
        file: 'source/example.test.ts',
        params: null,
        suite: [],
        title
    };
}

function addActiveCase(state: SupervisedRunState, testCase: CaseId): void {
    state.addActiveCase(
        caseIdentityKey(testCase),
        { capture: null, id: testCase, workId: { familyVariant: null, case: testCase, runtimes: [], workload: null } },
        0,
        { index: 0 }
    );
}

function isCapturedOutputArtifact(artifact: RunArtifact): artifact is CapturedOutputArtifact {
    return artifact.payload.kind === 'captured-output';
}

const assertCapturedOutputCap = defineCompositeAssertion({
    name: 'captured output limits',
    assert(check, artifacts: ReturnType<SupervisedRunState['artifacts']>) {
        const capped = artifacts[0];
        const overflow = artifacts[1];
        if (capped?.payload.kind !== 'captured-output') {
            return check.partialDeepEqual({ artifact: capped }, { artifact: { payload: { kind: 'captured-output' } } });
        }
        if (overflow?.payload.kind !== 'captured-output') {
            return check.partialDeepEqual({ artifact: overflow }, {
                artifact: { payload: { kind: 'captured-output' } }
            });
        }
        return check.group([
            check.equal(capped.payload.byteLength, capturedOutputLimitBytes),
            check.equal(overflow.payload.byteLength, 0),
            check.equal(overflow.payload.stream, 'stderr'),
            check.true(overflow.payload.truncated),
            check.equal(artifacts.length, 2)
        ]);
    }
});

const assertRunCapturedOutput = defineCompositeAssertion({
    name: 'run captured output',
    assert(check, state: SupervisedRunState, testCase: CaseId) {
        const artifact = state.artifacts()[0];
        if (artifact === undefined) {
            return check.defined(artifact);
        }
        if (!isCapturedOutputArtifact(artifact)) {
            return check.equal(artifact.payload.kind, 'captured-output');
        }
        return check.group([
            check.equal(artifact.id.scope.kind, 'run'),
            check.deepEqual(artifact.id.runtimes, []),
            check.equal(artifact.id.workload, null),
            check.equal(artifact.payload.text, 'setup output'),
            check.deepEqual(
                state.caseArtifacts({ familyVariant: null, case: testCase, runtimes: [], workload: null }, {
                    index: 0
                }),
                []
            )
        ]);
    }
});

function propertyCheckpoint(): PropertyCaseEvidence {
    const observation: PropertyFailureObservation = {
        trial: null,
        capture: { kind: 'unavailable' },
        input: serializeValue(100),
        failure: serializeValue('original failure')
    };
    return {
        invocations: [ {
            identity: 'declared-property',
            original: observation,
            retained: observation,
            diagnostics: [],
            summary: null,
            confirmedWitness: null,
            shrinkStatus: 'in-progress'
        } ]
    };
}

const assertInterruptedProperty = defineCompositeAssertion({
    name: 'interrupted property',
    assert(check, results: ReturnType<SupervisedRunState['perTestResults']>, property: PropertyCaseEvidence) {
        const result = results[0];
        if (result === undefined) {
            return check.defined(result);
        }
        if (result.property === null) {
            return check.defined(result.property);
        }
        const invocation = result.property.invocations[0];
        if (invocation === undefined) {
            return check.defined(invocation);
        }
        return check.group([
            check.equal(result.verdict, 'crashed'),
            check.equal(invocation.shrinkStatus, 'interrupted'),
            check.equal(
                JSON.stringify(invocation.retained),
                JSON.stringify(property.invocations[0]?.retained)
            ),
            check.equal(JSON.stringify(result.attempts[0].property), JSON.stringify(result.property))
        ]);
    }
});

type CompletionFixture = {
    readonly state: SupervisedRunState;
    readonly key: string;
    readonly selected: ReadonlyMap<string, SupervisedCase>;
    readonly start: Extract<ReporterEvent, { readonly kind: 'test-start'; }>;
    readonly end: Extract<ReporterEvent, { readonly kind: 'test-end'; }>;
};
type VariantFixture = CompletionFixture & { readonly result: PerTestResult; readonly workId: WorkId; };

function completionFixture(): CompletionFixture {
    const state = createSupervisedRunState('first-failure-and-final');
    const id = caseId('accepted');
    const workId = createDefaultWorkId(id);
    const key = workIdentityKey(workId);
    const selected = new Map([ [ key, { capture: null, id, workId } ] ]);
    const start: Extract<ReporterEvent, { readonly kind: 'test-start'; }> = {
        kind: 'test-start',
        case: id,
        workId,
        attempt: 0,
        definitionLocations: [ { kind: 'unknown' as const } ],
        suitePath: []
    };
    const end: Extract<ReporterEvent, { readonly kind: 'test-end'; }> = {
        ...start,
        kind: 'test-end',
        completion: 'final' as const,
        outcome: { kind: 'pass' as const },
        verdict: 'pass' as const,
        artifacts: [],
        property: null,
        benchmark: null,
        durationMicroseconds: 1
    };
    return { state, key, selected, start, end };
}

function variantFixture(): VariantFixture {
    const fixture = completionFixture();
    const result = runResultFactory
        .build({
            perTest: [ {
                id: fixture.start.case,
                workId: fixture.start.workId,
                verdict: 'pass'
            } ]
        })
        .perTest[0];
    if (result === undefined) {
        throw new Error('Expected result to satisfy defined.');
    }
    return { ...fixture, result, workId: result.workId };
}

const concurrentOutputEvidence = defineCompositeAssertion({
    name: 'captured output retains every concurrent case owner',
    assert(check, artifacts: readonly RunArtifact[], activeCases: readonly CaseId[]) {
        const captured = artifacts.filter(isCapturedOutputArtifact);
        return check.group([
            check.equal(artifacts.length, 2),
            check.equal(captured.length, 2),
            ...captured.map(function caseOwnership(artifact) {
                const owner = artifact.id.scope;
                if (owner.kind !== 'case') {
                    return check.equal(owner.kind, 'case');
                }
                return check.group([
                    check.equal(artifact.payload.kind, 'captured-output'),
                    check.equal(owner.confidence, 'concurrent-active'),
                    check.deepEqual(owner.activeCases, activeCases),
                    check.equal(artifact.payload.text, 'shared output')
                ]);
            })
        ]);
    }
});
const runtimeOutputEvidence = defineCompositeAssertion({
    name: 'captured output retains runtime scenario identity',
    assert(check, artifact: RunArtifact | undefined, runtime: RunArtifact['id']['runtimes'][number]) {
        if (artifact === undefined) {
            return check.defined(artifact);
        }
        if (!isCapturedOutputArtifact(artifact)) {
            return check.equal(artifact.payload.kind, 'captured-output');
        }
        return check.group([
            check.deepEqual(artifact.id.runtimes, [ runtime ]),
            check.equal(artifact.id.workload, null)
        ]);
    }
});

export const testNode = suite('Supervised run state', [
    test('rejects stale and duplicate completion without changing accepted history', function (scope) {
        const { state, selected, start, end } = completionFixture();
        applyEvent(start, state, selected, 0);
        scope.assert.throws(function () {
            applyEvent(start, state, selected, 0);
        }, {
            message: 'Runtime start is duplicate or out of order.'
        });
        scope.assert.throws(function () {
            applyEvent({ ...end, attempt: 1 }, state, selected, 1);
        }, {
            message: 'Runtime evidence does not belong to the active attempt.'
        });
        applyEvent(end, state, selected, 1);
        scope.assert.throws(function () {
            applyEvent(end, state, selected, 2);
        }, {
            message: 'Runtime evidence does not belong to the active attempt.'
        });
        scope.assert.deepEqual(
            state.perTestResults().map(function result(entry) {
                return { attempts: entry.attempts.length, duration: entry.durationMicroseconds };
            }),
            [ { attempts: 1, duration: 1 } ]
        );
        state.assertResults(state.perTestResults(), selected);
        scope.assert.throws(
            function () {
                state.assertResults([ ...state.perTestResults(), ...state.perTestResults() ], selected);
            },
            { message: 'Runtime results contain foreign or duplicate work identities.' }
        );
        return scope.assert.collect();
    }),
    test('rejects variant substitution and contradictory final snapshots', function (scope) {
        const { state, result, key, selected, start, workId } = variantFixture();
        scope.assert.throws(function () {
            state.assertEvent({
                ...start,
                workId: {
                    ...workId,
                    familyVariant: { family: 'other', key: 'compiler' }
                }
            }, selected);
        }, { message: 'Runtime evidence does not identify selected work.' });
        state.recordPerTestResult(key, result, 1);
        scope.assert.throws(function () {
            state.assertResults([ { ...result, verdict: 'inconclusive' } ], selected);
        }, {
            message: 'Runtime result contradicts accepted completion evidence.'
        });
        scope.assert.equal(state.activeCases.size, 0);
        scope.assert.equal(state.perTestResults()[0]?.verdict, result.verdict);
        return scope.assert.collect();
    }),
    test('reconciles retained body outcomes after a policy failure', function (scope) {
        const fixture = variantFixture();
        const final: PerTestResult = {
            ...fixture.result,
            outcome: null,
            verdict: 'runtime-policy',
            attempts: [ {
                ...fixture.result.attempts[0],
                verdict: 'runtime-policy'
            } ]
        };
        const reported: PerTestResult = { ...final, attempts: [ { ...final.attempts[0], outcome: null } ] };
        fixture.state.recordPerTestResult(fixture.key, reported, 1);
        fixture.state.assertResults([ final ], fixture.selected);
        scope.assert.equal(final.attempts[0].outcome?.kind, 'pass');
        scope.assert.equal(fixture.state.perTestResults().length, 1);
        scope.assert.equal(fixture.state.perTestResults()[0]?.verdict, 'runtime-policy');
        return scope.assert.collect();
    }),
    test('selects authored live capture only for a single active case', function (scope) {
        const state = createSupervisedRunState('first-failure-and-final');
        scope.assert.equal(state.captureMode('buffered'), 'buffered');
        state.addActiveCase(
            'live',
            { capture: 'live', id: caseId('live'), workId: createDefaultWorkId(caseId('live')) },
            0,
            { index: 0 }
        );
        scope.assert.equal(state.captureMode('buffered'), 'live');
        addActiveCase(state, caseId('concurrent'));
        scope.assert.equal(state.captureMode('buffered'), 'buffered');
        scope.assert.equal(state.captureMode('live'), 'live');
        return scope.assert.collect();
    }),
    test('preserves authored live capture while terminal output drains', function (scope: TestScope) {
        const state = createSupervisedRunState('first-failure-and-final');
        const result = runResultFactory.build({ perTest: [ { id: caseId('live') } ] }).perTest[0];
        scope.require.defined(result);
        const key = workIdentityKey(result.workId);
        state.addActiveCase(key, { capture: 'live', id: result.id, workId: result.workId }, 0, { index: 0 });
        state.recordTestAttemptResult(key, result, 'final', 1);
        state.removeActiveCase(key);
        state.beginOutputDraining();
        scope.assert.equal(state.captureMode('buffered'), 'live');
        return scope.assert.collect();
    }),
    test('retains property progress delivered through the supervised event boundary', function (scope) {
        const state = createSupervisedRunState('first-failure-and-final');
        const id = caseId('transported property progress');
        const workId = createDefaultWorkId(id);
        const key = workIdentityKey(workId);
        const property = propertyCheckpoint();
        state.addActiveCase(key, { capture: null, id, workId }, 0, { index: 0 });
        applyEvent(
            {
                kind: 'property-progress',
                property,
                case: id,
                workId,
                attempt: 0,
                definitionLocations: [ { kind: 'unknown' } ],
                suitePath: []
            },
            state,
            new Map([ [ key, { capture: null, id, workId } ] ]),
            1
        );
        state.recordTerminalActiveCases('crashed', 10);
        scope.assert(assertInterruptedProperty, state.perTestResults(), property);
        return scope.assert.collect();
    }),
    test('ignores property progress received after case termination', function (scope) {
        const state = createSupervisedRunState('first-failure-and-final');
        const id = caseId('late property progress');
        const key = caseIdentityKey(id);
        const property = propertyCheckpoint();
        addActiveCase(state, id);
        state.recordPropertyProgress(key, 0, property);
        state.recordTerminalActiveCases('crashed', 10);
        state.recordPropertyProgress(key, 0, { invocations: [] });
        scope.assert(assertInterruptedProperty, state.perTestResults(), property);
        return scope.assert.collect();
    }),
    test('retains property evidence on interruption and ignores stale attempts', function (scope) {
        const state = createSupervisedRunState('first-failure-and-final');
        const id = caseId('interrupted property');
        const key = caseIdentityKey(id);
        const property = propertyCheckpoint();
        addActiveCase(state, id);
        state.recordPropertyProgress(key, 0, property);
        state.recordPropertyProgress(key, 1, { invocations: [] });
        state.recordTerminalActiveCases('crashed', 10);
        scope.assert(assertInterruptedProperty, state.perTestResults(), property);
        return scope.assert.collect();
    }),
    test(
        'duplicates captured output across concurrent active cases',
        function (scope) {
            const state = createSupervisedRunState('first-failure-and-final');
            const firstCase = caseId('first');
            const secondCase = caseId('second');

            addActiveCase(state, firstCase);
            addActiveCase(state, secondCase);
            state.recordCapturedOutput('stdout', Buffer.from('shared output'), 1);

            scope.assert(concurrentOutputEvidence, state.artifacts(), [ firstCase, secondCase ]);

            return scope.assert.collect();
        }
    ),
    test('attributes captured output to runtime scenarios', function (scope) {
        const state = createSupervisedRunState('first-failure-and-final');
        const testCase = caseId('scenario output');
        const runtime = {
            dimensions: {},
            name: 'api',
            scenarios: { api: 'payments-500' },
            variantId: null
        };

        state.addActiveCase(
            caseIdentityKey(testCase),
            {
                capture: null,
                id: testCase,
                workId: { familyVariant: null, case: testCase, runtimes: [ runtime ], workload: null }
            },
            0,
            { index: 0 }
        );
        state.recordCapturedOutput('stdout', Buffer.from('scenario output'), 1);

        scope.assert(runtimeOutputEvidence, state.artifacts()[0], runtime);

        return scope.assert.collect();
    }),
    test('records out-of-test output as run artifacts', function (scope) {
        const state = createSupervisedRunState('first-failure-and-final');
        const testCase = caseId('unrelated');

        state.recordCapturedOutput('stderr', Buffer.from('setup output'), 1);

        scope.assert(assertRunCapturedOutput, state, testCase);

        return scope.assert.collect();
    }),
    test('applies one captured-output cap per active case', function (scope) {
        const state = createSupervisedRunState('first-failure-and-final');
        const testCase = caseId('capped');

        addActiveCase(state, testCase);
        state.recordCapturedOutput('stdout', Buffer.alloc(capturedOutputLimitBytes, 'a'), 1);
        state.recordCapturedOutput('stderr', Buffer.from('overflow'), 2);
        for (let index = 0; index < 1000; index += 1) {
            state.recordCapturedOutput('stdout', Buffer.from('discarded'), 3);
            state.recordCapturedOutput('stderr', Buffer.alloc(0), 4);
        }

        scope.assert(assertCapturedOutputCap, state.artifacts());

        return scope.assert.collect();
    })
]);
