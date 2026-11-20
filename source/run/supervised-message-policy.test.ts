import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { debugArtifactForWork } from '../test-support/debug-artifact-fixture.ts';

import { supervisedMessageRuntime, type SupervisedMessageFixture } from '../test-support/supervised-message-runtime.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { benchmarkHtmlFixture } from '../test-support/benchmark-html-fixture.ts';
import { testNode as assignmentPolicy } from './supervised-assignment-policy.test.ts';
import type { WorkId, ReporterEvent, RunArtifact } from './run-engine-primitives.ts';

type CaseCompletionEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;
function caseCompletion(work: WorkId, artifacts: readonly RunArtifact[]): CaseCompletionEvent {
    return {
        kind: 'test-end',
        case: work.case,
        workId: work,
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
function recordActiveCheckpoint(fixture: SupervisedMessageFixture, artifact: RunArtifact): void {
    fixture.receive({
        kind: 'event',
        event: {
            kind: 'test-start',
            case: fixture.work.case,
            workId: fixture.work,
            attempt: 0,
            definitionLocations: [ { kind: 'unknown' } ],
            suitePath: []
        }
    });
    fixture.runtime.state.recordArtifact(artifact);
}

export const testNode = authoredSuite('supervised child message policy', [
    authoredTest('retains resource observation progress before final results', async function (scope: TestScope) {
        const fixture = supervisedMessageRuntime(scope, false, true);
        const snapshot: Extract<ReporterEvent, { readonly kind: 'resource-check-progress'; }>['snapshot'] = {
            owner: { run: 'run', id: 'owner', scope: 'per-run' },
            resource: 'service',
            revision: 1,
            interval: { kind: 'lifetime' },
            passing: 1,
            failures: [],
            errors: [],
            status: { kind: 'complete' }
        };
        fixture.receive({ kind: 'event', event: { kind: 'resource-check-progress', snapshot } });
        await fixture.runtime.reporterEvents.wait();
        scope.assert.deepEqual(fixture.runtime.state.resourceChecks(), [ snapshot ]);
        scope.assert.deepEqual(fixture.reported, [ { kind: 'resource-check-progress', snapshot } ]);
        return scope.assert.collect();
    }),
    authoredTest('retains measurement progress for an active child case', async function (scope: TestScope) {
        const fixture = supervisedMessageRuntime(scope, false, true);
        const benchmark = benchmarkHtmlFixture('progress').perTest[0]?.benchmark;
        scope.require.defined(benchmark);
        fixture.receive({
            kind: 'event',
            event: {
                kind: 'test-start',
                case: fixture.work.case,
                workId: fixture.work,
                attempt: 0,
                definitionLocations: [ { kind: 'unknown' } ],
                suitePath: []
            }
        });
        const event: ReporterEvent = {
            kind: 'benchmark-progress',
            workId: fixture.work,
            benchmark,
            attempt: 0,
            case: fixture.work.case,
            definitionLocations: [ { kind: 'unknown' } ],
            suitePath: []
        };
        fixture.receive({ kind: 'event', event });
        await fixture.runtime.reporterEvents.wait();
        scope.assert.equal(fixture.runtime.state.activeCases.values().next().value?.benchmark, benchmark);
        scope.assert.true(fixture.reported.includes(event));
        return scope.assert.collect();
    }),
    authoredTest('ignores process samples after terminal failure', function (scope: TestScope) {
        const fixture = supervisedMessageRuntime(scope, false, true);
        fixture.runtime.terminalFailure.write(true);
        fixture.receive({
            kind: 'sample',
            sample: {
                activeResourceCount: 0,
                activeResourceTypes: [],
                capturedAtMicroseconds: 1,
                javaScriptEngineHeapBytes: 1,
                residentSetBytes: 1
            }
        });
        scope.assert.equal(fixture.runtime.previousSample.read(), null);
        scope.assert.deepEqual(fixture.reported, []);
        return scope.assert.collect();
    }),
    assignmentPolicy,
    ...[ false, true ].map(function (completedDebug) {
        return authoredTest(
            `prefers completed debug evidence with final debug ${completedDebug}`,
            async function (scope: TestScope) {
                const fixture = supervisedMessageRuntime(scope, false, true);
                const checkpoint = await debugArtifactForWork(fixture.work);
                const completed = { ...checkpoint, payload: { ...checkpoint.payload, durationMicroseconds: 10 } };
                recordActiveCheckpoint(fixture, checkpoint);
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

    authoredTest('ignores session transport updates during ordinary result aggregation', function (scope: TestScope) {
        const fixture = supervisedMessageRuntime(scope, false, true);
        fixture.receive({ kind: 'execution-data', data: null });
        fixture.receive({ kind: 'execution-checkpoint', data: null });
        scope.assert.equal(fixture.runtime.completedResult.read(), null);
        scope.assert.deepEqual(fixture.reported, []);
        return scope.assert.collect();
    }),
    authoredTest('retains collection errors alongside the delivered plan', function (scope: TestScope) {
        const fixture = supervisedMessageRuntime(scope, false, false);
        const errors = runResultFactory.build({ runnerErrors: [ { message: 'Collection failed.' } ] }).runnerErrors;
        fixture.receive({ kind: 'collected', collectedPlan: fixture.plan, runnerErrors: errors });
        scope.assert.equal(fixture.runtime.collectedPlan.read(), fixture.plan);
        scope.assert.deepEqual(fixture.runtime.state.runnerErrors(), errors);
        return scope.assert.collect();
    }),
    ...[ false, true ].map(function (collected) {
        return authoredTest(`retains reporter errors with collection ${collected}`, async function (scope: TestScope) {
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
    authoredTest(
        'settles and reports coordinated attachments for legacy case completion events',
        async function (scope: TestScope) {
            const fixture = supervisedMessageRuntime(scope, false, true);
            fixture.receive({
                kind: 'event',
                event: {
                    kind: 'test-start',
                    case: fixture.work.case,
                    workId: fixture.work,
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
                    workId: fixture.work,
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
