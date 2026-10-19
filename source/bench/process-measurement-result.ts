import type { MetricReading } from '../engine/benchmark-result.ts';
import type { ProcessCommand } from './process-command.ts';
import type { ProcessOutput } from './process-output.ts';
import type { ProcessCompletionResult } from './process-interactions.ts';
import type { MetricReadings } from './measurement-types.ts';
import type { MeasuredProcess, ProcessObservation } from './process-observation.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { unavailableChildMetrics, type NodeProbeReport } from './process-node-readings.ts';
import { microsecondsPerSecond, nanosecondsPerMicrosecond } from './measurement-units.ts';

type ProcessMeasurementInput = {
    readonly request: ProcessCommand;
    readonly instrumentation: 'node' | 'off';
    readonly completed: ProcessCompletionResult;
    readonly output: ProcessOutput;
    readonly started: bigint;
    readonly report: NodeProbeReport | null;
};
const nanosecondsPerMillisecond = 1_000_000;

function observedCompletion(input: ProcessMeasurementInput): ProcessObservation['completion'] {
    if (input.request.completion.kind !== 'exit') {
        return { kind: input.request.completion.kind };
    }
    if (input.completed.exit?.code === null || input.completed.exit === null) {
        throw new Error('Exit completion requires an observed exit code.');
    }
    return { kind: 'exit', code: input.completed.exit.code };
}

function outputLatency(started: bigint, observed: bigint | null): MetricReading {
    const provenance = { collector: 'process-wall-clock-v1', scope: 'process' as const, unit: 'milliseconds' };
    return observed === null
        ? unavailableMetric('The corresponding output marker was not observed or configured.', provenance)
        : availableMetric(Number(observed - started) / nanosecondsPerMillisecond, provenance);
}

function measuredOutputBytes(output: ProcessOutput): MetricReading {
    const snapshot = output.snapshot();
    const bytes = snapshot.kind === 'pipes' ? snapshot.stdout.bytes + snapshot.stderr.bytes : snapshot.terminal.bytes;
    return availableMetric(bytes, { collector: 'process-output-v1', scope: 'process', unit: 'bytes' });
}

type TimingMetric = 'durationMicroseconds' | 'firstOutputMilliseconds' | 'operationsPerSecond';
type ProcessWallReadings = Pick<MeasuredProcess['metrics'], TimingMetric | 'outputBytes' | 'startupMilliseconds'>;
type ProcessTimingReadings = MetricReadings & ProcessWallReadings;

function processTimings(input: ProcessMeasurementInput): ProcessTimingReadings {
    const duration = Number(input.completed.time - input.started) / nanosecondsPerMicrosecond;
    const provenance = { collector: 'process-wall-clock-v1', scope: 'process' as const, unit: 'microseconds' };
    const throughput = { ...provenance, unit: 'operations/second' };
    return {
        durationMicroseconds: availableMetric(duration, provenance),
        operationsPerSecond: duration === 0
            ? unavailableMetric('Measured duration is zero.', throughput)
            : availableMetric(microsecondsPerSecond / duration, throughput),
        firstOutputMilliseconds: outputLatency(input.started, input.output.firstOutput()),
        startupMilliseconds: outputLatency(input.started, input.completed.readiness),
        outputBytes: measuredOutputBytes(input.output),
        ...input.completed.interactions
    };
}

function childMetrics(input: ProcessMeasurementInput): NodeProbeReport['metrics'] {
    return input.report?.metrics ?? unavailableChildMetrics('Node child instrumentation is off.');
}

function processMetadata(input: ProcessMeasurementInput): ProcessObservation['metadata'] {
    const terminal = input.request.kind === 'pty'
        ? { name: input.request.name, columns: input.request.columns, rows: input.request.rows }
        : null;
    return {
        version: 1,
        instrumentation: input.instrumentation,
        runtime: input.report?.runtime ?? null,
        observationMicroseconds: input.report?.observationMicroseconds ?? null,
        backend: input.request.kind,
        terminal
    };
}

export function processMeasurementResult(input: ProcessMeasurementInput): MeasuredProcess {
    return {
        value: {
            completion: observedCompletion(input),
            output: input.output.snapshot(),
            metadata: processMetadata(input)
        },
        metrics: { ...processTimings(input), ...childMetrics(input) }
    };
}
