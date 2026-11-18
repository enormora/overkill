import { createDeterministicClock } from '@enormora/clock';
import { normalizeConfig } from '../config/config.ts';
import type { BenchmarkBaselineSessionInput } from '../run/benchmark-baseline-session.ts';
import type { PerformanceBaselineStore } from '../baselines/performance-store.ts';
import type { BaselineUpdateMode } from '../baselines/performance-baseline.ts';
import type { DefinedReporter, ReporterEvent } from '../engine/reporter.ts';
import { ordinaryBaselineSessionFixture } from './ordinary-baseline-session.ts';
import { memoryPerformanceBaselines } from './memory-performance-baselines.ts';
import { storedPerformanceFixture } from './performance-storage.ts';
import { defaultRunRequest } from './run-command-factory.ts';

type BenchmarkSessionScenario = {
    readonly mode: BaselineUpdateMode;
    readonly maxBytes: number;
    readonly existing: boolean;
};
export const benchmarkSessionScenario: BenchmarkSessionScenario = { mode: 'none', maxBytes: 65_536, existing: false };
type BenchmarkSessionFixture = {
    readonly input: BenchmarkBaselineSessionInput;
    readonly store: PerformanceBaselineStore;
    readonly reporter: DefinedReporter;
    readonly events: readonly ReporterEvent[];
};
export function benchmarkBaselineSessionFixture(input: BenchmarkSessionScenario): BenchmarkSessionFixture {
    const reporting = ordinaryBaselineSessionFixture();
    const config = normalizeConfig({
        profiles: {
            bench: {
                testFamily: 'benchmark',
                files: { include: [ 'subject.bench.ts' ] },
                execution: { processModel: 'supervised-process' }
            }
        }
    });
    const profile = config.profiles['bench'];
    if (profile?.testFamily !== 'benchmark') {
        throw new Error('Missing benchmark session profile.');
    }
    return {
        store: memoryPerformanceBaselines(input.existing ? [ { ...storedPerformanceFixture, profile: 'bench' } ] : []),
        reporter: reporting.reporter,
        events: reporting.events,
        input: {
            calibration: { kind: 'comparable', context: {}, metadata: {}, machineClass: 'unit-host' },
            clock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
            profile: { ...profile, attachments: { ...profile.attachments, maxArtifactBytes: input.maxBytes } },
            projectRoot: '/project',
            reporterDispatcher: reporting.dispatcher,
            request: defaultRunRequest({ profile: 'bench', baselineUpdateMode: input.mode })
        }
    };
}
