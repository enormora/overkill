import type { BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { attachmentFixture, attachmentWork } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { workload } from './workload.ts';
import { recordRawSamples, generatedBudgetAssertions } from './benchmark-sampling-evidence.ts';
import { createMetricObservations, type MetricObservations } from './benchmark-observations.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';

const result: BenchmarkExecutionResult = {
    samples: 2,
    budgets: [],
    status: 'complete',
    workload: { name: 'one', params: {} },
    policy: defaultSamplingPolicy,
    assumption: 'independent-stationary-observations',
    metrics: {},
    rawSamples: { status: 'omitted', reference: null, reason: 'not persisted' }
};

function sampleObservations(): MetricObservations {
    const observations = createMetricObservations();
    const provenance = { collector: 'custom', scope: 'custom' as const, unit: 'bytes' };
    observations.append(availableMetric(3, provenance));
    observations.append(unavailableMetric('unsupported', provenance));
    return observations;
}

export const testNode = suite('benchmark raw evidence', [
    test('requires generated checks and preserves undecided lower-bound diagnostics', function (scope) {
        const context = { locations: [ { kind: 'unknown' as const } ], workload: workload('one', {}) } as const;
        scope.assert.throws(function () {
            return generatedBudgetAssertions([], context);
        }, { message: 'Benchmark requires generated budget assertions.' });
        const checks = generatedBudgetAssertions([ {
            metric: 'value',
            statistic: { kind: 'observed-minimum' },
            minimum: 2,
            maximum: null,
            estimate: 1,
            interval: { lower: null, upper: null },
            decision: 'undecided',
            precise: false
        } ], context);
        scope.assert.partialDeepEqual(checks, [ {
            actual: true,
            message:
                'one: value observed-minimum budget [2, unbounded]: undecided; estimate 1, interval [-unbounded, unbounded].'
        } ]);
        return scope.assert.collect();
    }),
    test('records raw readings with provenance through the attachment coordinator', async function (scope: TestScope) {
        const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
        const observations = sampleObservations();
        const recorded = await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
            return await fixture.execution.runAttempt(attachmentWork, { index: 0 }, async function ownedAttempt() {
                return await recordRawSamples(result, new Map([ [ 'value', observations ] ]));
            });
        });
        const artifact = fixture.store.artifacts()[0];
        scope.require.defined(artifact);
        scope.assert.deepEqual(recorded.rawSamples, {
            status: 'recorded',
            reference: JSON.stringify(artifact.id),
            reason: null
        });
        scope.assert.partialDeepEqual(artifact.payload.content, {
            kind: 'json',
            value: { value: observations.readings() }
        });
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    }),
    test('reports attachment limits as omitted raw evidence', async function (scope) {
        const fixture = await attachmentFixture(scope, {
            ...defaultAttachmentLimits,
            maxInlineBytes: 1,
            maxArtifactBytes: 1,
            maxScopeBytes: 1
        });
        const observations = createMetricObservations();
        observations.append(availableMetric(3, { collector: 'custom', scope: 'custom', unit: 'bytes' }));
        const recorded = await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
            return await fixture.execution.runAttempt(attachmentWork, { index: 0 }, async function ownedAttempt() {
                return await recordRawSamples(result, new Map([ [ 'value', observations ] ]));
            });
        });
        scope.assert.equal(recorded.rawSamples.status, 'omitted');
        scope.assert.defined(recorded.rawSamples.reference);
        scope.assert.defined(recorded.rawSamples.reason);
        scope.assert.deepEqual(await fixture.execution.finish(), []);
        return scope.assert.collect();
    })
]);
