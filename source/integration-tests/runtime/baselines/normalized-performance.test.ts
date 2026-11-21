import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { memoryPerformanceBaselines } from '../../../test-support/memory-performance-baselines.ts';
import type { RunResult } from '../../../packages/engine/engine.entry-point.ts';

import { recordedMachine, type MachineRecording } from '../../../test-support/normalized-machine.ts';
import { normalizationBaselineAdapter } from '../../../test-support/normalization-baseline-adapter.ts';
import type { PerformanceBaselineStore } from '../../../baselines/performance-store.ts';
import { createPerformanceWorkflow, type PerformanceWorkflow } from '../../../baselines/performance-workflow.ts';
import type { BenchmarkCaseEnd } from '../../../baselines/performance-check.ts';

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
const saveNormalizedExpectation = defineCompositeAssertion({
    name: 'save normalized expectation',
    async assert(check, saving: PerformanceWorkflow, result: RunResult) {
        const evaluation = saving.evaluate(completedBenchmark(result));
        const initialChecks = check.group([
            check.deepEqual(evaluation.errors, []),
            check.equal(evaluation.event.verdict, 'pass')
        ]);
        const change = saving.changes[0];
        if (change === undefined || change === null) {
            return check.group([ initialChecks, check.defined(change) ]);
        }
        const intermediateChecks = check.group([
            check.defined(change),
            check.equal(change.baseline.expected.value, 10)
        ]);
        await saving.store.apply(change);
        return check.group([ initialChecks, intermediateChecks ]);
    }
});
type FastMachineFixture = {
    readonly store: PerformanceBaselineStore;
    readonly fast: MachineRecording;
    readonly saving: PerformanceWorkflow;
};
async function savedFastMachine(): Promise<FastMachineFixture> {
    const store = memoryPerformanceBaselines([]);
    const fast = await recordedMachine(100, 'fast-mac', 1000);
    const saving = await workflow(store, 'fast-mac', 'update');
    return { store, fast, saving };
}
export const testNode = suite('portable normalized performance expectations', [
    test('reuses a fast-machine snapshot on slower hardware without rewriting it', async function (scope) {
        const { store, fast, saving } = await savedFastMachine();
        scope.assert.deepEqual(fast.completionErrors, []);
        await scope.assert(saveNormalizedExpectation, saving, fast);
        const slow = await recordedMachine(400, 'slow-arm-runner', 4000);
        scope.assert.deepEqual(slow.completionErrors, []);
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
    test('detects a snapshot regression after accounting for slower hardware', async function (scope) {
        const { store, fast, saving } = await savedFastMachine();
        scope.assert.deepEqual(fast.completionErrors, []);
        await scope.assert(saveNormalizedExpectation, saving, fast);
        const slow = await recordedMachine(400, 'slow-arm-runner', 4400);
        scope.assert.deepEqual(slow.completionErrors, []);
        const comparing = await workflow(store, 'slow-arm-runner', 'none');
        const evaluation = comparing.evaluate(completedBenchmark(slow));
        scope.assert.deepEqual(evaluation.errors, []);
        scope.assert.equal(slow.status, 'passed');
        scope.assert.equal(evaluation.event.verdict, 'fail');
        return scope.assert.collect();
    })
]);
