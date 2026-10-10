import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type {
    PerformanceBaselineAdapter,
    StoredPerformanceBaseline
} from '../packages/baselines/baselines.entry-point.ts';
import {
    evaluatePerformanceBaseline,
    performanceBaselineError,
    type BenchmarkCaseEnd
} from './performance-evaluation.ts';
import { createPerformanceWorkflow } from './performance-workflow.ts';
import { performanceReportArtifact } from './performance-report.ts';

const calibration = { context: {}, kind: 'comparable', machineClass: 'test-host', metadata: {} } as const;
const event: BenchmarkCaseEnd = {
    artifacts: [],
    attempt: 0,
    case: createCaseId('startup.bench.ts', [], 'starts', null),
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

export const testNode = suite('performance baseline boundaries', [
    test(
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
            scope.assert.deepEqual(result, { change: null, checks: [], participates: false });
            const failure = performanceBaselineError('Unavailable metric.', event);
            scope.assert.equal(failure.message, 'Unavailable metric.');
            const attributedWork = failure.attributedToWork;
            scope.require.defined(attributedWork);
            scope.assert.deepEqual(attributedWork, createDefaultWorkId(event.case));
            scope.assert.equal(performanceBaselineError('Storage unavailable.', null).attributedTo, null);
            return scope.assert.collect();
        }
    ),
    test('rejects observations and reports that exceed the byte limit', function (scope: TestScope) {
        scope.assert.throws(function oversizedObservation() {
            evaluatePerformanceBaseline({ ...input, maxBytes: 0 });
        }, { message: 'Performance observation exceeds the configured artifact byte limit.' });
        scope.assert.throws(function oversizedReport() {
            performanceReportArtifact({
                capturedAtMicroseconds: 0,
                maxBytes: 1,
                report: { calibration, changes: [], writeOutcome: { kind: 'read-only' } },
                result: runResultFactory.build({})
            });
        }, { message: 'Performance baseline report exceeds the configured artifact byte limit.' });
        return scope.assert.collect();
    }),
    test('rejects adapter mismatches without diagnostics', function (scope: TestScope) {
        const invalidAdapter = { ...adapter };
        Reflect.set(invalidAdapter, 'compare', function missingDiagnostics() {
            return { diagnostics: [], kind: 'mismatch' };
        });
        scope.assert.throws(function invalidComparison() {
            evaluatePerformanceBaseline({ ...input, adapter: invalidAdapter });
        }, { message: 'Performance comparison mismatch requires diagnostics.' });
        return scope.assert.collect();
    }),
    test('deduplicates final events and proposes the default work identity', async function (scope: TestScope) {
        const projectRoot = await mkdtemp(path.join(tmpdir(), 'overkill-baseline-events-'));
        scope.cleanup(async function removeStore() {
            await rm(projectRoot, { recursive: true, force: true });
        });
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
            directory: 'baselines',
            maxBytes: 4096,
            mode: 'update',
            profile: 'startup',
            projectRoot
        });
        scope.assert.deepEqual(workflow.evaluate(event).errors, []);
        scope.assert.deepEqual(workflow.evaluate(event).errors, []);
        scope.assert.equal(observations, 1);
        await assertPendingProposal(scope, workflow);
        return scope.assert.collect();
    })
]);
