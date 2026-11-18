import type { BenchmarkHostAssessment } from '../bench/benchmark-host-snapshot.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunCommand } from './run-types.ts';

export function withBenchmarkErrorMetadata(
    result: RunResult,
    command: RunCommand,
    host: BenchmarkHostAssessment | null
): RunResult {
    const profile = command.config.profiles[command.request.profile];
    if (profile?.testFamily !== 'benchmark' || result.preparationFacts !== null) {
        return result;
    }
    return {
        ...result,
        preparationFacts: {
            environment: { node: { arch: process.arch, platform: process.platform, version: process.version } },
            execution: {
                testFamily: 'benchmark',
                profile: command.request.profile,
                processModel: profile.execution.processModel,
                scheduling: profile.execution.scheduling,
                maxConcurrency: profile.execution.maxConcurrency,
                workerCount: null,
                workerLifecycle: null
            },
            benchmarkHost: host,
            benchmarkPlacement: null,
            benchmarkNormalization: null,
            benchmarkCalibration: null
        }
    };
}
