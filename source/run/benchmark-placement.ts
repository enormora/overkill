import type { BenchmarkDefinitionSummary } from '../engine/benchmark-result.ts';
import type {
    BenchmarkHostAssessment,
    BenchmarkHostSnapshot,
    HostReading,
    BenchmarkPlacementFacts,
    BenchmarkPlacementLimit
} from '../bench/benchmark-host-snapshot.ts';

type BenchmarkPlacementInput = {
    readonly definitions: readonly (BenchmarkDefinitionSummary | null)[];
    readonly host: BenchmarkHostAssessment | null;
    readonly processModel: 'supervised-process' | 'worker-pool';
};

const timingMetrics: ReadonlySet<string> = new Set([ 'durationMicroseconds', 'operationsPerSecond' ]);
const percentScale = 100;

function parallelMeasurement(definition: BenchmarkDefinitionSummary | null): boolean {
    if (
        definition?.kind !== 'bundle-size' || definition.measurement.mode === 'process' ||
        definition.measurement.collectors.length > 0
    ) {
        return false;
    }
    const metrics = [
        ...definition.diagnostics,
        ...Object.values(definition.budgets).flatMap(function budgetMetrics(budgets) {
            return budgets.map(function metric(budget) {
                return budget.metric;
            });
        })
    ];
    return Object.keys(definition.normalization).length === 0 && metrics.every(function artifactMetric(name) {
        return !timingMetrics.has(name);
    });
}

function validPercentage(reading: HostReading<number>): reading is HostReading<number> & {
    readonly availability: 'available';
} {
    return reading.availability === 'available' && Number.isFinite(reading.value) &&
        reading.value >= 0 && reading.value <= percentScale;
}

function validCount(reading: HostReading<number>): reading is HostReading<number> & {
    readonly availability: 'available';
} {
    return reading.availability === 'available' && Number.isSafeInteger(reading.value) && reading.value > 0;
}

function platformPressure(snapshot: BenchmarkHostSnapshot): boolean {
    const readings = snapshot.runtime.operatingSystem === 'linux'
        ? [
            snapshot.signals.linuxCpuStallPercent,
            snapshot.signals.linuxMemoryStallPercent,
            snapshot.signals.linuxIoStallPercent
        ]
        : [];
    const throttling = snapshot.runtime.operatingSystem === 'darwin'
        ? [ snapshot.signals.darwinCpuSpeedPercent, snapshot.signals.darwinCpuSchedulerPercent ]
        : [];
    return readings.some(function stalled(reading) {
        return reading.availability === 'available' && (!validPercentage(reading) || reading.value > 0);
    }) || throttling.some(function throttled(reading) {
        return reading.availability === 'available' && (!validPercentage(reading) || reading.value < percentScale);
    });
}

function observedLoad(reading: BenchmarkHostSnapshot['capacity']['loadAverage']): number | null {
    if (reading.availability === 'unavailable') {
        return 0;
    }
    const load = reading.value[0];
    return Number.isFinite(load) && load >= 0 ? load : null;
}

function cpuHeadroom(snapshot: BenchmarkHostSnapshot): number | null {
    const { availableParallelism, logicalCpuCount } = snapshot.capacity;
    const { cpuBusyPercent } = snapshot.signals;
    if (!validCount(availableParallelism) || !validCount(logicalCpuCount) || !validPercentage(cpuBusyPercent)) {
        return null;
    }
    const load = observedLoad(snapshot.capacity.loadAverage);
    if (load === null) {
        return null;
    }
    const demand = Math.max(logicalCpuCount.value * cpuBusyPercent.value / percentScale, load);
    return Math.max(1, Math.floor(availableParallelism.value - demand - 1));
}

function hostLimits(host: BenchmarkHostAssessment | null): readonly BenchmarkPlacementLimit[] {
    if (host === null) {
        return [ { reason: 'uncalibrated', maximumWorkers: 1 } ];
    }
    const { snapshot } = host;
    const maximumWorkers = cpuHeadroom(snapshot);
    const { availableMemoryPercent } = snapshot.signals;
    if (maximumWorkers === null || !validPercentage(availableMemoryPercent)) {
        return [ { reason: 'host-evidence', maximumWorkers: 1 } ];
    }
    return [
        { reason: 'cpu-headroom', maximumWorkers },
        ...availableMemoryPercent.value === 0
            ? [ { reason: 'memory-pressure' as const, maximumWorkers: 1 } ]
            : [],
        ...platformPressure(snapshot)
            ? [ { reason: 'platform-pressure' as const, maximumWorkers: 1 } ]
            : []
    ];
}

export function resolveBenchmarkPlacement(input: BenchmarkPlacementInput): BenchmarkPlacementFacts {
    const limits: readonly BenchmarkPlacementLimit[] = [
        ...input.definitions.every(parallelMeasurement)
            ? []
            : [ { reason: 'measurement' as const, maximumWorkers: 1 } ],
        ...hostLimits(input.host),
        ...input.processModel === 'supervised-process'
            ? [ { reason: 'process-model' as const, maximumWorkers: 1 } ]
            : []
    ];
    return {
        policy: 'conservative-size-only-v1',
        maximumWorkers: Math.min(...limits.map(function maximum(limit) {
            return limit.maximumWorkers;
        })),
        limits
    };
}
