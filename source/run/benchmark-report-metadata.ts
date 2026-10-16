import { appendRunnerErrors } from '../engine/execution-result.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { runJsonArtifact } from '../attachments/run-json-artifact.ts';
import {
    benchmarkRunMediaType,
    readBenchmarkRunMetadata,
    type BenchmarkRunMetadata
} from '../bench/benchmark-run-report.ts';
import type { BenchmarkHostAssessment } from '../bench/benchmark-host-snapshot.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RunFacts, RunCommand } from './run-types.ts';

function attachMetadata(
    result: RunResult,
    metadata: BenchmarkRunMetadata,
    maxBytes: number,
    capturedAtMicroseconds: number
): RunResult {
    try {
        const artifact = runJsonArtifact({
            result,
            value: metadata,
            name: 'benchmark-run',
            mediaType: benchmarkRunMediaType,
            maxBytes,
            capturedAtMicroseconds
        });
        return { ...result, artifacts: [ ...result.artifacts, artifact ] };
    } catch (error: unknown) {
        return appendRunnerErrors(result, [ {
            attributedTo: null,
            attributedToAttempt: null,
            attributedToWork: null,
            cause: error,
            diagnostics: [],
            message: error instanceof Error ? error.message : String(error),
            subtype: 'artifact'
        } ]);
    }
}
export function withBenchmarkRunMetadata(
    result: RunResult,
    facts: RunFacts,
    capturedAtMicroseconds: number
): RunResult {
    const { execution } = facts;
    if (execution.testFamily !== 'benchmark') {
        return result;
    }
    const metadata: BenchmarkRunMetadata = {
        version: 2,
        host: facts.benchmarkHost,
        node: facts.environment.node,
        calibration: facts.benchmarkCalibration,
        execution: {
            profile: execution.profile,
            processModel: execution.processModel,
            scheduling: execution.scheduling,
            maxConcurrency: execution.maxConcurrency,
            workerCount: execution.processModel === 'worker-pool' ? execution.workerCount.resolved : null,
            workerLifecycle: execution.processModel === 'worker-pool' ? execution.workerLifecycle : null
        }
    };
    return attachMetadata(
        result,
        metadata,
        execution.attachments?.maxArtifactBytes ?? defaultAttachmentLimits.maxArtifactBytes,
        capturedAtMicroseconds
    );
}

export function withBenchmarkErrorMetadata(
    result: RunResult,
    command: RunCommand,
    host: BenchmarkHostAssessment | null
): RunResult {
    const profile = command.config.profiles[command.request.profile];
    if (profile?.testFamily !== 'benchmark' || readBenchmarkRunMetadata(result) !== null) {
        return result;
    }
    const metadata: BenchmarkRunMetadata = {
        version: 2,
        host,
        node: { arch: process.arch, platform: process.platform, version: process.version },
        calibration: null,
        execution: {
            profile: command.request.profile,
            processModel: profile.execution.processModel,
            scheduling: profile.execution.scheduling,
            maxConcurrency: profile.execution.maxConcurrency,
            workerCount: null,
            workerLifecycle: null
        }
    };
    return attachMetadata(result, metadata, profile.attachments.maxArtifactBytes, 0);
}
