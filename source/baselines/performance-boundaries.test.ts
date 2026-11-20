import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { memoryPerformanceBaselines } from '../test-support/memory-performance-baselines.ts';

import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import type {
    PerformanceBaselineAdapter,
    StoredPerformanceBaseline
} from '../packages/baselines/baselines.entry-point.ts';
import { testDouble } from '../doubles/test-double.ts';
import type { BenchmarkCaseEnd } from './performance-check.ts';
import { evaluatePerformanceBaseline, performanceBaselineError } from './performance-evaluation.ts';
import {
    createPerformanceWorkflow,
    type PerformanceWorkflow,
    type PerformanceWorkflowInput
} from './performance-workflow.ts';

const calibration = { context: {}, kind: 'comparable', machineClass: 'test-host', metadata: {} } as const;
const event: BenchmarkCaseEnd = {
    property: null,
    benchmark: null,
    artifacts: [],
    attempt: 0,
    case: createCaseId('startup.bench.ts', [], 'starts', null),
    workId: {
        familyVariant: null,
        case: createCaseId('startup.bench.ts', [], 'starts', null),
        runtimes: [],
        workload: null
    },
    completion: 'final',
    definitionLocations: [ { kind: 'unknown' } ],
    durationMicroseconds: 1,
    kind: 'test-end',
    outcome: { kind: 'pass' },
    suitePath: [],
    verdict: 'pass'
};
const adapter: PerformanceBaselineAdapter = {
    id: 'duration',
    observe() {
        return { kind: 'observed', value: 1 };
    },
    propose(input) {
        return input.actual.value;
    },
    compare() {
        return { kind: 'match' };
    }
};
const baseline: StoredPerformanceBaseline = {
    normalization: null,
    measurement: null,
    adapter: adapter.id,
    expected: { calibration, value: 1 },
    profile: 'startup',
    subtype: 'performance-baseline',
    version: 1,
    work: createDefaultWorkId(event.case)
};
const input = {
    adapter,
    calibration,
    event,
    existing: baseline,
    maxBytes: 4096,
    mode: 'none',
    profile: 'startup'
} as const;

async function assertPendingProposal(
    scope: TestScope,
    workflow: Awaited<ReturnType<typeof createPerformanceWorkflow>>
): Promise<void> {
    scope.assert.equal(workflow.changes.length, 1);
    const work = workflow.changes[0]?.baseline.work;
    scope.require.defined(work);
    scope.assert.deepEqual(work, createDefaultWorkId(event.case));
    scope.assert.deepEqual(await workflow.store.list(), []);
}
async function presentationWorkflow(
    selectedAdapter: PerformanceBaselineAdapter
): Promise<PerformanceWorkflow> {
    return await createPerformanceWorkflow({
        adapters: [ selectedAdapter ],
        calibration,
        store: memoryPerformanceBaselines([]),
        maxBytes: 4096,
        mode: 'update',
        profile: 'startup'
    });
}

async function storedWorkflow(
    mode: PerformanceWorkflowInput['mode'],
    existing: readonly StoredPerformanceBaseline[]
): Promise<PerformanceWorkflow> {
    return await createPerformanceWorkflow({
        adapters: [ adapter ],
        calibration,
        store: memoryPerformanceBaselines(existing),
        maxBytes: 4096,
        mode,
        profile: 'startup'
    });
}
function completedRun(): RunResult {
    return runResultFactory.build({
        perTest: [ { id: event.case, workId: createDefaultWorkId(event.case), outcome: { kind: 'pass' } } ],
        summary: { defined: 1, discovered: 1, planned: 1, passed: 1 }
    });
}

export const testNode = authoredSuite('performance baseline boundaries', [
    authoredTest('does not observe intermediate attempts', async function (scope: TestScope) {
        const workflow = await presentationWorkflow({
            ...adapter,
            observe: testDouble.throws(new Error('Unexpected observation.'))
        });
        scope.assert.deepEqual(workflow.evaluate({ ...event, completion: 'retry' }), {
            errors: [],
            event: { ...event, completion: 'retry' }
        });
        scope.assert.deepEqual(workflow.present(), { comparisons: [], errors: [] });
        return scope.assert.collect();
    }),
    authoredTest('retains non-Error observation diagnostics', async function (scope: TestScope) {
        const workflow = await presentationWorkflow({
            ...adapter,
            observe: testDouble.throws('Observation unavailable.')
        });
        scope.assert.equal(workflow.evaluate(event).errors[0]?.message, 'Observation unavailable.');
        scope.assert.partialDeepEqual(workflow.present(), {
            comparisons: [ {
                observation: { kind: 'error', reason: 'Observation unavailable.' },
                presentation: { kind: 'unavailable' }
            } ]
        });
        return scope.assert.collect();
    }),
    authoredTest('retains proposals when chart extraction fails', async function (scope: TestScope) {
        const workflow = await presentationWorkflow({
            ...adapter,
            describeMetrics: testDouble.throws(new Error('Invalid chart.'))
        });
        scope.assert.deepEqual(workflow.evaluate(event).errors, []);
        const presented = workflow.present();
        scope.assert.equal(presented.errors[0]?.message, 'duration chart metadata: Invalid chart.');
        scope.assert.equal(presented.comparisons[0]?.observation.kind, 'observed');
        scope.assert.equal(presented.comparisons[0]?.presentation.kind, 'error');
        scope.assert.equal(workflow.changes[0]?.kind, 'create');
        return scope.assert.collect();
    }),
    authoredTest(
        'excludes inapplicable observations and attributes errors without an explicit work identity',
        function (scope: TestScope) {
            const result = evaluatePerformanceBaseline({
                ...input,
                adapter: {
                    ...adapter,
                    observe() {
                        return { kind: 'not-applicable' };
                    }
                }
            });
            scope.assert.deepEqual(result, {
                change: null,
                checks: [],
                participates: false,
                observation: { kind: 'not-applicable' }
            });
            const failure = performanceBaselineError('Unavailable metric.', event);
            scope.assert.equal(failure.message, 'Unavailable metric.');
            const attributedWork = failure.attributedToWork;
            scope.require.defined(attributedWork);
            scope.assert.deepEqual(attributedWork, createDefaultWorkId(event.case));
            scope.assert.equal(performanceBaselineError('Storage unavailable.', null).attributedTo, null);
            return scope.assert.collect();
        }
    ),
    authoredTest('rejects observations that exceed the byte limit', function (scope: TestScope) {
        scope.assert.throws(function oversizedObservation() {
            evaluatePerformanceBaseline({ ...input, maxBytes: 0 });
        }, { message: 'Performance observation exceeds the configured artifact byte limit.' });
        return scope.assert.collect();
    }),
    authoredTest('rejects adapter mismatches without diagnostics', function (scope: TestScope) {
        const invalidAdapter = { ...adapter };
        Reflect.set(invalidAdapter, 'compare', function missingDiagnostics() {
            return { diagnostics: [], kind: 'mismatch' };
        });
        scope.assert.throws(function invalidComparison() {
            evaluatePerformanceBaseline({ ...input, adapter: invalidAdapter });
        }, { message: 'Performance comparison mismatch requires diagnostics.' });
        return scope.assert.collect();
    }),
    authoredTest('deduplicates final events and proposes the default work identity', async function (scope: TestScope) {
        let observations = 0;
        const workflow = await createPerformanceWorkflow({
            adapters: [ {
                ...adapter,
                observe() {
                    observations += 1;
                    return { kind: 'observed', value: 1 };
                }
            } ],
            calibration,
            store: memoryPerformanceBaselines([]),
            maxBytes: 4096,
            mode: 'update',
            profile: 'startup'
        });
        scope.assert.deepEqual(workflow.evaluate(event).errors, []);
        scope.assert.deepEqual(workflow.evaluate(event).errors, []);
        scope.assert.equal(observations, 1);
        await assertPendingProposal(scope, workflow);
        return scope.assert.collect();
    }),
    authoredTest('applies comparison failures to the final result and its attempt', async function (scope: TestScope) {
        const workflow = await storedWorkflow('none', []);
        const evaluated = workflow.evaluate(event);
        const finished = workflow.finish(completedRun(), true);
        scope.assert.equal(evaluated.event.verdict, 'fail');
        scope.assert.equal(finished.result.status, 'failed');
        scope.assert.equal(finished.result.summary.failed, 1);
        scope.assert.equal(finished.result.perTest[0]?.attempts[0].verdict, 'fail');
        scope.assert.deepEqual(finished.errors, []);
        return scope.assert.collect();
    }),
    ...[ 'apply', 'diff' ].map(function reconciliationMode(mode) {
        return authoredTest(`removes stale baselines in ${mode} mode`, async function (scope: TestScope) {
            const stale = { ...baseline, work: createDefaultWorkId({ ...event.case, title: 'removed' }) };
            const workflow = await storedWorkflow(mode === 'apply' ? 'apply' : 'diff', [ baseline, stale ]);
            workflow.evaluate(event);
            const finished = workflow.finish(completedRun(), true);
            scope.assert.deepEqual(finished.errors, []);
            scope.assert.deepEqual(workflow.changes, [ { kind: 'remove', baseline: stale } ]);
            return scope.assert.collect();
        });
    }),
    authoredTest('reports stale inventory when pruning is not requested', async function (scope: TestScope) {
        const stale = { ...baseline, work: createDefaultWorkId({ ...event.case, title: 'removed' }) };
        const workflow = await storedWorkflow('none', [ baseline, stale ]);
        workflow.evaluate(event);
        const finished = workflow.finish(completedRun(), true);
        scope.assert.equal(
            finished.errors[0]?.message,
            'Found 1 stale performance baselines. Use "overkill bench baseline apply".'
        );
        scope.assert.deepEqual(workflow.changes, []);
        return scope.assert.collect();
    }),
    authoredTest('keeps pending baselines when the run inventory is incomplete', async function (scope: TestScope) {
        const workflow = await storedWorkflow('apply', [ baseline ]);
        const finished = workflow.finish(completedRun(), false);
        scope.assert.deepEqual(finished.errors, []);
        scope.assert.deepEqual(workflow.changes, []);
        return scope.assert.collect();
    }),
    authoredTest('does not observe cases that already failed during execution', async function (scope: TestScope) {
        const workflow = await storedWorkflow('update', []);
        const failed = {
            ...event,
            verdict: 'inconclusive' as const,
            outcome: { kind: 'inconclusive' as const, reason: 'not executed' }
        };
        scope.assert.deepEqual(workflow.evaluate(failed), { event: failed, errors: [] });
        scope.assert.equal(workflow.present().comparisons[0]?.observation.kind, 'not-evaluated');
        scope.assert.deepEqual(workflow.changes, []);
        return scope.assert.collect();
    }),
    authoredTest(
        'ignores stored expectations from other profiles and machine classes',
        async function (scope: TestScope) {
            const foreignProfile = { ...baseline, profile: 'other' };
            const foreignMachine = {
                ...baseline,
                expected: { ...baseline.expected, calibration: { ...calibration, machineClass: 'other' } }
            };
            const workflow = await storedWorkflow('update', [ foreignProfile, foreignMachine ]);
            workflow.evaluate(event);
            scope.assert.equal(workflow.changes[0]?.kind, 'create');
            scope.assert.deepEqual(workflow.finish(completedRun(), true).errors, []);
            return scope.assert.collect();
        }
    )
]);
