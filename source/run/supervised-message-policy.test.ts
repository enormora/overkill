import { runIfMain } from '#test-runner';
import { debugArtifactForWork } from '../test-support/debug-artifact-fixture.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { supervisedMessageRuntime } from '../test-support/supervised-message-runtime.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { testNode as assignmentPolicy } from './supervised-assignment-policy.test.ts';
import type { WorkId, ReporterEvent, RunArtifact } from './run-engine-primitives.ts';

type CaseCompletionEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;
function caseCompletion(work: WorkId, artifacts: readonly RunArtifact[]): CaseCompletionEvent {
    return {
        kind: 'test-end',
        case: work.case,
        attempt: 0,
        definitionLocations: [ { kind: 'unknown' } ],
        suitePath: [],
        completion: 'final',
        artifacts,
        outcome: { kind: 'pass' },
        verdict: 'pass',
        property: null,
        benchmark: null,
        durationMicroseconds: 1
    };
}
export const testNode = suite('supervised child message policy', [
    assignmentPolicy,
    ...[ false, true ].map(function (completedDebug) {
        return test(
            `prefers completed debug evidence with final debug ${completedDebug}`,
            async function (scope: TestScope) {
                const fixture = supervisedMessageRuntime(scope, false, true);
                const checkpoint = await debugArtifactForWork(fixture.work);
                const completed = { ...checkpoint, payload: { ...checkpoint.payload, durationMicroseconds: 10 } };
                fixture.runtime.state.recordArtifact(checkpoint);
                fixture.receive({
                    kind: 'event',
                    event: caseCompletion(fixture.work, completedDebug ? [ completed ] : [])
                });
                await fixture.runtime.reporterEvents.wait();
                const event = fixture.reported.find(function (value) {
                    return value.kind === 'test-end';
                });
                scope.require.defined(event);
                scope.assert.deepEqual(
                    event.artifacts.map(function (artifact) {
                        return artifact.payload.kind === 'debug' ? artifact.payload.durationMicroseconds : null;
                    }),
                    [ completedDebug ? 10 : 5 ]
                );
                return scope.assert.collect();
            }
        );
    }),

    test('ignores session transport updates during ordinary result aggregation', function (scope: TestScope) {
        const fixture = supervisedMessageRuntime(scope, false, true);
        fixture.receive({ kind: 'execution-data', data: null });
        fixture.receive({ kind: 'execution-checkpoint', data: null });
        scope.assert.equal(fixture.runtime.completedResult.read(), null);
        scope.assert.deepEqual(fixture.reported, []);
        return scope.assert.collect();
    }),
    test('retains collection errors alongside the delivered plan', function (scope: TestScope) {
        const fixture = supervisedMessageRuntime(scope, false, false);
        const errors = runResultFactory.build({ runnerErrors: [ { message: 'Collection failed.' } ] }).runnerErrors;
        fixture.receive({ kind: 'collected', collectedPlan: fixture.plan, runnerErrors: errors });
        scope.assert.equal(fixture.runtime.collectedPlan.read(), fixture.plan);
        scope.assert.deepEqual(fixture.runtime.state.runnerErrors(), errors);
        return scope.assert.collect();
    }),
    ...[ false, true ].map(function (collected) {
        return test(`retains reporter errors with collection ${collected}`, async function (scope: TestScope) {
            const fixture = supervisedMessageRuntime(scope, true, collected);
            const error = runResultFactory.build({ runnerErrors: [ { message: 'Child failed.' } ] }).runnerErrors[0];
            scope.require.defined(error);
            fixture.receive({ kind: 'event', event: { kind: 'runner-error', error } });
            await fixture.runtime.reporterEvents.wait();
            scope.assert.deepEqual(
                fixture.runtime.state.runnerErrors().map(function (item) {
                    return item.message;
                }),
                collected ? [ 'Child failed.', 'Reporter delivery failed.' ] : [ 'Reporter delivery failed.' ]
            );
            return scope.assert.collect();
        });
    }),
    test(
        'settles and reports coordinated attachments for legacy case completion events',
        async function (scope: TestScope) {
            const fixture = supervisedMessageRuntime(scope, false, true);
            fixture.receive({
                kind: 'event',
                event: {
                    kind: 'test-start',
                    case: fixture.work.case,
                    attempt: 0,
                    definitionLocations: [ { kind: 'unknown' } ],
                    suitePath: []
                }
            });
            const artifact = await fixture.capture();
            fixture.receive({
                kind: 'event',
                event: {
                    kind: 'test-end',
                    case: fixture.work.case,
                    attempt: 0,
                    definitionLocations: [ { kind: 'unknown' } ],
                    suitePath: [],
                    completion: 'final',
                    artifacts: [],
                    outcome: { kind: 'pass' },
                    verdict: 'pass',
                    property: null,
                    benchmark: null,
                    durationMicroseconds: 1
                }
            });
            await fixture.runtime.reporterEvents.wait();
            const completed = fixture.reported.find(function (event) {
                return event.kind === 'test-end';
            });
            scope.require.defined(completed);
            scope.assert.deepEqual({ artifacts: completed.artifacts, active: fixture.runtime.state.activeCases.size }, {
                artifacts: [ artifact ],
                active: 0
            });
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);
