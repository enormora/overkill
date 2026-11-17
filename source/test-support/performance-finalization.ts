import type { ComparableCalibration } from '../bench/host-calibration-result.ts';
import type { PerformanceBaselineAdapter } from '../baselines/performance-adapter.ts';
import type { BaselineChange, BaselineUpdateMode } from '../baselines/performance-baseline.ts';
import { createPerformanceWorkflow, type PerformanceWorkflow } from '../baselines/performance-workflow.ts';
import type { PerformanceBaselineStore } from '../baselines/performance-store.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { baselineCaseEvent } from './baseline-case-fixture.ts';
import { memoryPerformanceBaselines } from './memory-performance-baselines.ts';

type PerformanceFinalizationFixture = {
    readonly workflow: PerformanceWorkflow;
    readonly calibration: ComparableCalibration;
    readonly store: PerformanceBaselineStore;
    readonly applied: readonly BaselineChange[];
    readonly notified: readonly RunnerError[];
    readonly notify: (errors: readonly RunnerError[]) => Promise<readonly RunnerError[]>;
};
const calibration: ComparableCalibration = {
    kind: 'comparable',
    context: {},
    metadata: {},
    machineClass: 'test-host'
};
const adapter: PerformanceBaselineAdapter = {
    id: 'duration',
    observe() {
        return { kind: 'observed', value: 42 };
    },
    propose(input) {
        return input.actual.value;
    },
    compare() {
        return { kind: 'match' };
    }
};
export async function performanceFinalization(
    mode: BaselineUpdateMode,
    failure: Error | null
): Promise<PerformanceFinalizationFixture> {
    const store = memoryPerformanceBaselines([]);
    const applied: BaselineChange[] = [];
    const notified: RunnerError[] = [];
    const workflow = await createPerformanceWorkflow({
        mode,
        calibration,
        adapters: [ adapter ],
        maxBytes: 4096,
        profile: 'unit',
        store: {
            ...store,
            async apply(change) {
                if (failure !== null) {
                    throw failure;
                }
                await store.apply(change);
                applied.push(change);
            }
        }
    });
    workflow.evaluate(baselineCaseEvent);
    return {
        workflow,
        calibration,
        store,
        applied,
        notified,
        async notify(errors) {
            notified.push(...errors);
            return [];
        }
    };
}
