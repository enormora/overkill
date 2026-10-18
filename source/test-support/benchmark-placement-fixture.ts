import type { BenchmarkDefinitionSummary } from '../engine/benchmark-result.ts';
import type { BenchmarkHostAssessment, HostReading } from '../bench/benchmark-host-snapshot.ts';
import { normalizeConfig } from '../config/config.ts';
import { createRunCoordinator, type RunCoordinator } from '../run/run.ts';
import { createCurrentProcessRunInput } from '../run/current-process-run-input.ts';
import { createNodeRunOrchestratorDependencies } from '../run/node-run-orchestrator-dependencies.ts';
import { defaultRunEngine } from '../run/default-run-engine.ts';
import { loadRunEngineModule, loadRunTestModules, runDiscovery } from '../run/node-run-dependencies.entry-point.ts';
import { startSupervisedChild, startWorkerPoolHost } from '../run/node-child-process-starters.ts';
import { benchmarkHostSnapshot } from './benchmark-host-snapshot.ts';

const hostCpuCount = 8;
const sampleCount = 128;

function reading(value: number): HostReading<number> {
    return { availability: 'available', value, source: 'fixture', scope: 'host', unit: 'percent' };
}

export function quietHost(): BenchmarkHostAssessment {
    const snapshot = benchmarkHostSnapshot();
    const profile = normalizeConfig({
        profiles: { sizes: { testFamily: 'benchmark', files: { include: [ 'sizes.bench.ts' ] } } }
    })
        .profiles
        .sizes;
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark profile.');
    }
    return {
        limits: profile.host.limits,
        checks: [],
        snapshot: {
            ...snapshot,
            capacity: {
                ...snapshot.capacity,
                availableParallelism: { ...reading(hostCpuCount), unit: 'count' },
                logicalCpuCount: { ...reading(hostCpuCount), unit: 'count' },
                loadAverage: {
                    availability: 'available',
                    value: [ 0, 0, 0 ],
                    source: 'fixture',
                    scope: 'host',
                    unit: 'load'
                }
            },
            signals: {
                ...snapshot.signals,
                cpuBusyPercent: reading(0),
                linuxCpuStallPercent: reading(0),
                linuxMemoryStallPercent: reading(0),
                linuxIoStallPercent: reading(0)
            }
        }
    };
}

export function definition(): BenchmarkDefinitionSummary {
    return {
        kind: 'bundle-size',
        workloads: [ { name: 'small', parameters: {} } ],
        measurement: { mode: 'sync', collectors: [] },
        diagnostics: [],
        budgets: {
            small: [ { metric: 'outputBytes', maximum: 100, minimum: null, statistic: { kind: 'observed-maximum' } } ]
        },
        policy: {
            confidenceLevel: 0.95,
            relativePrecision: 0.1,
            absolutePrecision: {},
            minimumSamples: sampleCount,
            maximumSamples: sampleCount
        }
    };
}

export function placementRunner(
    busyPercent: number,
    observe: () => void
): RunCoordinator['orchestrator'] {
    const dependencies = createNodeRunOrchestratorDependencies(createCurrentProcessRunInput(defaultRunEngine, {
        discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
        loadRunEngineModule,
        loadRunTestModules,
        startSupervisedChild,
        startWorkerPoolHost
    }));
    const { snapshot } = quietHost();
    return createRunCoordinator({
        ...dependencies,
        availableParallelism: hostCpuCount,
        collectBenchmarkHost() {
            observe();
            return { ...snapshot, signals: { ...snapshot.signals, cpuBusyPercent: reading(busyPercent) } };
        }
    })
        .orchestrator;
}
