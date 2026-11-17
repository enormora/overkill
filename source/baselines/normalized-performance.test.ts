import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { memoryPerformanceBaselines } from '../test-support/memory-performance-baselines.ts';
import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { recordedMachine } from '../test-support/normalized-machine.ts';
import { normalizationBaselineAdapter } from '../test-support/normalization-baseline-adapter.ts';
import type { PerformanceBaselineStore } from './performance-store.ts';
import { createPerformanceWorkflow, type PerformanceWorkflow } from './performance-workflow.ts';
import type { BenchmarkCaseEnd } from './performance-check.ts';

function completedBenchmark(result: RunResult): BenchmarkCaseEnd {
    const measured = result.perTest[0];
    if (measured === undefined) {
        throw new Error('Expected completed benchmark.');
    }
    return {
        ...measured,
        artifacts: result.artifacts,
        case: measured.workId.case,
        kind: 'test-end',
        completion: 'final',
        attempt: 0,
        suitePath: []
    };
}
async function workflow(
    store: PerformanceBaselineStore,
    machineClass: string,
    mode: 'none' | 'update'
): Promise<PerformanceWorkflow> {
    return await createPerformanceWorkflow({
        store,
        maxBytes: defaultAttachmentLimits.maxArtifactBytes,
        profile: 'bench',
        adapters: [ normalizationBaselineAdapter('storage') ],
        calibration: { kind: 'comparable', machineClass, metadata: {}, context: {} },
        mode
    });
}
async function saveNormalizedExpectation(
    scope: TestScope,
    saving: PerformanceWorkflow,
    result: RunResult
): Promise<void> {
    const evaluation = saving.evaluate(completedBenchmark(result));
    scope.assert.deepEqual(evaluation.errors, []);
    scope.assert.equal(evaluation.event.verdict, 'pass');
    const change = saving.changes[0];
    scope.require.defined(change);
    scope.assert.equal(change.baseline.expected.value, 10);
    await saving.store.apply(change);
}
async function savedFastMachine(scope: TestScope): Promise<PerformanceBaselineStore> {
    const store = memoryPerformanceBaselines([]);
    const fast = await recordedMachine(scope, 100, 'fast-mac', 1000);
    const saving = await workflow(store, 'fast-mac', 'update');
    await saveNormalizedExpectation(scope, saving, fast);
    return store;
}
export const testNode = suite('portable normalized performance expectations', [
    test('reuses a fast-machine snapshot on slower hardware without rewriting it', async function (scope: TestScope) {
        const store = await savedFastMachine(scope);
        const slow = await recordedMachine(scope, 400, 'slow-arm-runner', 4000);
        const comparing = await workflow(store, 'slow-arm-runner', 'none');
        const evaluation = comparing.evaluate(completedBenchmark(slow));
        scope.assert.deepEqual(evaluation.errors, []);
        scope.assert.equal(evaluation.event.verdict, 'pass');
        const updating = await workflow(store, 'slow-arm-runner', 'update');
        updating.evaluate(completedBenchmark(slow));
        scope.assert.deepEqual(
            updating.changes.map(function changed(change) {
                return { kind: change.kind, value: change.baseline.expected.value };
            }),
            []
        );
        return scope.assert.collect();
    }),
    test('detects a snapshot regression after accounting for slower hardware', async function (scope: TestScope) {
        const store = await savedFastMachine(scope);
        const slow = await recordedMachine(scope, 400, 'slow-arm-runner', 4400);
        const comparing = await workflow(store, 'slow-arm-runner', 'none');
        const evaluation = comparing.evaluate(completedBenchmark(slow));
        scope.assert.deepEqual(evaluation.errors, []);
        scope.assert.equal(slow.status, 'passed');
        scope.assert.equal(evaluation.event.verdict, 'fail');
        return scope.assert.collect();
    })
]);
