import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { ProcessCommand } from './process-command.ts';
import { prepareProcessLauncher, disposeProcessChild, type ProcessChild, type ProcessLaunch } from './process-child.ts';
import { processOutput, type ProcessOutput } from './process-output.ts';
import { completeProcess, type ProcessCompletionResult } from './process-interactions.ts';
import { createProcessProbe, type ProcessProbe } from './process-probe-session.ts';
import type { ProcessExecution } from './process-protocol.ts';
import type { MeasuredProcess } from './process-observation.ts';
import { processMeasurementResult } from './process-measurement-result.ts';
import type { NodeProbeReport } from './process-node-readings.ts';

export type ProcessExecutionInput = {
    readonly request: ProcessCommand;
    readonly instrumentation: 'node' | 'off';
    readonly maximumBytes: number;
    readonly signal: AbortSignal;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly started: (pid: number) => void;
};
type StartedProcess = { readonly child: ProcessChild; readonly time: bigint; };
type OwnedProcess = {
    readonly child: ProcessChild;
    readonly output: ProcessOutput;
    readonly observing: StoredValue<Promise<void> | null>;
    readonly releasing: StoredValue<Promise<void> | null>;
    readonly failure: StoredValue<string | null>;
};
type CommandMeasurement = {
    readonly input: ProcessExecutionInput;
    readonly output: ProcessOutput;
    readonly child: StoredValue<OwnedProcess | null>;
    readonly probe: StoredValue<ProcessProbe | null>;
    readonly measured: StoredValue<MeasuredProcess | null>;
    readonly failure: StoredValue<string | null>;
    readonly cleanupFailure: StoredValue<string | null>;
};

function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function withProcessCancellation<Value>(signal: AbortSignal, operation: Promise<Value>): Promise<Value> {
    const cancelled = Promise.withResolvers<never>();
    const abort = function processAborted(): void {
        cancelled.reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
        abort();
    }
    try {
        return await Promise.race([ operation, cancelled.promise ]);
    } finally {
        signal.removeEventListener('abort', abort);
        cancelled.reject(new Error('Process cancellation observation ended.'));
    }
}

async function releaseOwnedProcess(owner: OwnedProcess): Promise<void> {
    owner.releasing.write(owner.releasing.read() ?? disposeProcessChild(owner.child));
    await owner.releasing.read();
}

async function closeOwnedOutput(owner: OwnedProcess): Promise<void> {
    try {
        await releaseOwnedProcess(owner);
    } catch (error: unknown) {
        owner.failure.write(failureMessage(error));
    } finally {
        owner.output.finish(new Error('Process closed before the requested output marker.'));
    }
}

async function observeOwnedExit(owner: OwnedProcess): Promise<void> {
    try {
        await owner.child.exit;
    } catch {
        return;
    } finally {
        await closeOwnedOutput(owner);
    }
}

function ownProcess(child: ProcessChild, output: ProcessOutput): OwnedProcess {
    const owner: OwnedProcess = {
        child,
        output,
        observing: createStoredValue<Promise<void> | null>(null),
        releasing: createStoredValue<Promise<void> | null>(null),
        failure: createStoredValue<string | null>(null)
    };
    owner.observing.write(observeOwnedExit(owner));
    return owner;
}

async function closeMeasuredChild(measurement: CommandMeasurement): Promise<void> {
    const owner = measurement.child.read();
    if (owner !== null) {
        await closeOwnedOutput(owner);
        await owner.observing.read();
        measurement.cleanupFailure.write(owner.failure.read());
    }
}

function launchInput(measurement: CommandMeasurement): ProcessLaunch {
    const probe = measurement.probe.read();
    return {
        request: measurement.input.request,
        arguments: [ ...probe?.arguments ?? [], ...measurement.input.request.command.slice(1) ],
        environment: { ...measurement.input.request.env ?? measurement.input.environment, ...probe?.environment },
        output: measurement.output
    };
}

function identifyMeasuredChild(measurement: CommandMeasurement, child: ProcessChild): void {
    if (child.pid !== null) {
        measurement.probe.read()?.identify(child.pid);
        measurement.input.started(child.pid);
    }
}

async function startMeasuredProcess(measurement: CommandMeasurement): Promise<StartedProcess> {
    measurement.input.signal.throwIfAborted();
    const launch = await prepareProcessLauncher(measurement.input.request.kind);
    measurement.probe.write(measurement.input.instrumentation === 'node' ? await createProcessProbe() : null);
    measurement.input.signal.throwIfAborted();
    const time = process.hrtime.bigint();
    const child = launch(launchInput(measurement));
    measurement.child.write(ownProcess(child, measurement.output));
    identifyMeasuredChild(measurement, child);
    return { child, time };
}

async function measuredProbeReport(
    measurement: CommandMeasurement,
    completed: ProcessCompletionResult,
    exited: Promise<unknown>
): Promise<NodeProbeReport | null> {
    if (completed.exit !== null) {
        await closeMeasuredChild(measurement);
    }
    const probe = measurement.probe.read();
    if (probe === null) {
        return null;
    }
    return completed.exit === null ? await probe.checkpointSnapshot(exited) : await probe.finalSnapshot();
}

async function measureCommand(measurement: CommandMeasurement): Promise<void> {
    const started = await startMeasuredProcess(measurement);
    const completed = await withProcessCancellation(
        measurement.input.signal,
        completeProcess(measurement.input.request.completion, started.child, measurement.output)
    );
    const report = await measuredProbeReport(measurement, completed, started.child.exit);
    measurement.measured.write(processMeasurementResult({
        request: measurement.input.request,
        instrumentation: measurement.input.instrumentation,
        completed,
        output: measurement.output,
        started: started.time,
        report
    }));
}

async function closeMeasuredProbe(measurement: CommandMeasurement): Promise<void> {
    await measurement.probe.read()?.dispose();
}

async function disposeMeasurement(measurement: CommandMeasurement): Promise<void> {
    try {
        await closeMeasuredChild(measurement);
    } catch (error: unknown) {
        measurement.cleanupFailure.write(failureMessage(error));
    }
    try {
        await closeMeasuredProbe(measurement);
    } catch (error: unknown) {
        measurement.cleanupFailure.write(
            [ measurement.cleanupFailure.read(), failureMessage(error) ].filter(Boolean).join('; ')
        );
    }
}

function commandMeasurement(input: ProcessExecutionInput): CommandMeasurement {
    return {
        input,
        output: processOutput(input.request.kind, input.maximumBytes),
        child: createStoredValue<OwnedProcess | null>(null),
        probe: createStoredValue<ProcessProbe | null>(null),
        measured: createStoredValue<MeasuredProcess | null>(null),
        failure: createStoredValue<string | null>(null),
        cleanupFailure: createStoredValue<string | null>(null)
    };
}

export async function executeProcessCommand(input: ProcessExecutionInput): Promise<ProcessExecution> {
    const measurement = commandMeasurement(input);
    try {
        await measureCommand(measurement);
    } catch (error: unknown) {
        measurement.failure.write(failureMessage(error));
    } finally {
        await disposeMeasurement(measurement);
    }
    const result = measurement.measured.read();
    return result === null
        ? {
            status: 'failed',
            message: measurement.failure.read() ?? 'Process measurement failed.',
            output: measurement.output.snapshot(),
            cleanupFailure: measurement.cleanupFailure.read()
        }
        : { status: 'measured', result, cleanupFailure: measurement.cleanupFailure.read() };
}
