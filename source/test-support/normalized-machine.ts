import { createClock } from '@enormora/clock';
import {
    createRoot,
    createTestPlan,
    type RunResult,
    type TestScope,
    type TestCase,
    type BenchmarkExecutionEnvironment
} from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runWithAttachmentExecution } from '../run/resource-lifecycle-state.ts';
import { createExecute } from '../engine/execution.ts';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import {
    benchmark,
    calibratedMeasurement,
    defineCalibrationResource,
    wallClockMeasurement,
    workload,
    availableMetric,
    defaultSamplingPolicy,
    type CalibrationResource,
    type BenchmarkExecutionResult
} from '../packages/bench/bench.entry-point.ts';
import { attachmentFixtureForWork } from './attachment-fixture.ts';

const referenceThroughput = 400;
const lifecycle = { garbageCollection: 'off', warmupSamples: 0, cooldown: { mode: 'off' } } as const;
const sampling = { ...defaultSamplingPolicy, minimumSamples: 128, maximumSamples: 128, relativePrecision: 1 };
export const options = { annotations: {}, controls: {}, lifecycle, sampling };
function unexpectedOutput(): never {
    throw new Error('Unexpected benchmark output.');
}
export function referenceResource(cost: number, observe: () => void): CalibrationResource {
    return defineCalibrationResource({
        workload: workload('storage-reference', { bytes: 4096 }),
        version: '1',
        unit: 'ticks',
        dependencies: {},
        measurement: wallClockMeasurement(),
        measure({ sample }) {
            observe();
            return availableMetric(
                sample
                    .measure(function () {
                        return cost;
                    })
                    .value,
                {
                    collector: 'storage-probe',
                    scope: 'custom',
                    unit: 'ticks'
                }
            );
        }
    }, { lifecycle, sampling });
}
export async function executeMachine(
    node: TestCase,
    benchmarkEnvironment: BenchmarkExecutionEnvironment
): Promise<RunResult> {
    const clock = createClock();
    const execute = createExecute({
        wallClock: clock,
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes() {
            return [];
        },
        reporterDispatcher: createReporterDispatcher({
            wallClock: clock,
            stdout: { writeLine: unexpectedOutput },
            stderr: { writeLine: unexpectedOutput }
        }),
        benchmarkEnvironment
    });
    return await execute(
        createTestPlan(createRoot({ title: 'machines', annotations: {}, controls: {}, children: [ node ] }))
    );
}
export async function measuredMachine(
    cost: number,
    machineClass: string,
    value: number,
    observe: () => void
): Promise<RunResult> {
    const calibration = referenceResource(cost, observe);
    const node = benchmark('portable storage budget', {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: calibratedMeasurement(wallClockMeasurement(), {
            value: { calibration, scaling: 'proportional' },
            throughput: { calibration, scaling: 'inverse' }
        }),
        measure({ sample }) {
            const measured = sample.measure(function () {
                return value;
            });
            return { value: measured.value, throughput: referenceThroughput / cost, bytes: 17 };
        },
        diagnosticMetrics: [],
        budgets: {
            one: {
                value: { maximum: 12, statistic: { kind: 'observed-maximum' } },
                throughput: { minimum: 300, statistic: { kind: 'observed-minimum' } },
                bytes: { maximum: 20, statistic: { kind: 'observed-maximum' } }
            }
        }
    }, options);
    return await executeMachine(node, {
        profileGarbageCollection: 'off',
        garbageCollection: { kind: 'unavailable', reason: 'Not requested.' },
        normalization: {
            mode: 'compare',
            profile: 'bench',
            machine: { machineClass, metadata: {} },
            references: [],
            saved: []
        }
    });
}
export function firstBenchmark(result: RunResult): BenchmarkExecutionResult {
    const measured = result.perTest[0]?.benchmark;
    if (measured === null || measured === undefined) {
        throw new Error('Expected benchmark evidence.');
    }
    return measured;
}
export async function recordedMachine(
    scope: TestScope,
    cost: number,
    machineClass: string,
    value: number
): Promise<RunResult> {
    const preview = await measuredMachine(cost, machineClass, value, function () {
        return undefined;
    });
    const work = preview.perTest[0]?.workId;
    scope.require.defined(work);
    const fixture = await attachmentFixtureForWork(scope, defaultAttachmentLimits, [ work ]);
    const result = await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
        return await fixture.execution.runAttempt(work, { index: 0 }, async function measuredAttempt() {
            return await measuredMachine(cost, machineClass, value, function () {
                return undefined;
            });
        });
    });
    scope.assert.deepEqual(await fixture.execution.finish(), []);
    return { ...result, artifacts: fixture.store.artifacts() };
}
