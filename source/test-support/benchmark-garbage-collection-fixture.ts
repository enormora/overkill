import { createClock } from '@enormora/clock';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { createRoot, createTestPlan, type TestCase, type RunResult } from '../packages/engine/engine.entry-point.ts';
import {
    benchmark,
    defaultSamplingPolicy,
    wallClockMeasurement,
    workload,
    type BenchmarkDefinition,
    type BenchmarkMeasureContext,
    type BenchmarkMetrics,
    type BenchmarkLifecyclePolicy
} from '../packages/bench/bench.entry-point.ts';
import type { BenchmarkExecutionEnvironment } from '../engine/benchmark-environment.ts';

const epoch = new Date(0);

function ignoreLine(): void {
    return undefined;
}

export function measureConstantValue(
    context: BenchmarkMeasureContext<Readonly<Record<string, never>>>
): BenchmarkMetrics {
    return {
        value: context
            .sample
            .measure(function () {
                return 1;
            })
            .value
    };
}

export const shortLifecycle: BenchmarkLifecyclePolicy = {
    garbageCollection: 'after-sample',
    warmupSamples: 1,
    cooldown: { mode: 'off' }
};

export function garbageCollectionBenchmark(
    measure: BenchmarkDefinition<Readonly<Record<string, never>>>['measure'],
    lifecycle: BenchmarkLifecyclePolicy
): TestCase {
    return benchmark('garbage collection', {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: wallClockMeasurement(),
        measure,
        diagnosticMetrics: [],
        budgets: { one: { value: { maximum: 2, statistic: { kind: 'observed-maximum' } } } }
    }, {
        annotations: {},
        controls: { timeoutMilliseconds: 100 },
        lifecycle,
        sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
    });
}

export async function executeGarbageCollectionBenchmark(
    node: TestCase,
    benchmarkEnvironment: BenchmarkExecutionEnvironment | null
): Promise<RunResult> {
    const wallClock = createClock();
    const execute = createExecute({
        benchmarkEnvironment,
        asyncLeakDiagnostics: 'disabled',
        readActiveResourceTypes() {
            return [];
        },
        wallClock,
        reporterDispatcher: createReporterDispatcher({
            wallClock,
            stderr: { writeLine: ignoreLine },
            stdout: { writeLine: ignoreLine }
        })
    });
    return await execute(
        createTestPlan(createRoot({
            title: 'root',
            children: [ node ],
            annotations: {},
            controls: {}
        })),
        {
            execution: { mode: 'serial-in-process' },
            reporters: [],
            retryPolicy: null,
            runFacts: {},
            startedAt: epoch.toISOString(),
            timeoutPolicy: { hardTimeoutMilliseconds: 2000, timeoutMilliseconds: 100 }
        }
    );
}
