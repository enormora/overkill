import { resolve } from 'node:path';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { ProcessHelper } from './process-helper.ts';
import type { ProcessSample } from './process-measurement.ts';
import { parseProcessRequest, type ProcessCommand, type ProcessRequest } from './process-command.ts';
import type { ProcessExecution } from './process-protocol.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';
import type { MeasuredProcess } from './process-observation.ts';

export type ProcessSampleLifetime = {
    readonly sample: ProcessSample;
    readonly ensureMeasured: () => void;
    readonly dispose: () => Promise<void>;
};
type ProcessInvocationInput = {
    readonly helper: () => ProcessHelper;
    readonly signal: AbortSignal;
    readonly observe: (execution: ProcessExecution) => void;
};
type InvocationState = 'closed' | 'complete' | 'open' | 'running';
type ProcessInvocation = {
    readonly input: ProcessInvocationInput;
    readonly controller: AbortController;
    readonly signal: AbortSignal;
    readonly state: StoredValue<InvocationState>;
    readonly pending: StoredValue<Promise<MeasuredProcess> | null>;
    readonly cleanupFailure: StoredValue<string | null>;
    readonly contractFailure: StoredValue<boolean>;
};

async function measureInvocation(invocation: ProcessInvocation, command: ProcessCommand): Promise<MeasuredProcess> {
    const execution = await invocation.input.helper().run({ ...command, cwd: resolve(command.cwd) }, invocation.signal);
    invocation.cleanupFailure.write(execution.cleanupFailure);
    invocation.input.observe(execution);
    invocation.signal.throwIfAborted();
    if (execution.status === 'failed') {
        throw new MeasurementContractError(execution.message, { cause: execution });
    }
    invocation.state.write('complete');
    return execution.result;
}

async function runInvocation(invocation: ProcessInvocation, request: ProcessRequest): Promise<MeasuredProcess> {
    if (invocation.state.read() !== 'open') {
        invocation.contractFailure.write(true);
        throw new MeasurementContractError('Each process sample must await exactly one process region.', {});
    }
    invocation.state.write('running');
    invocation.signal.throwIfAborted();
    const pending = measureInvocation(invocation, parseProcessRequest(request));
    invocation.pending.write(pending);
    return await pending;
}

function ensureMeasured(invocation: ProcessInvocation): void {
    if (invocation.state.read() !== 'complete' || invocation.contractFailure.read()) {
        throw new MeasurementContractError('Each process sample must await exactly one complete process region.', {});
    }
}

async function stopPending(pending: Promise<MeasuredProcess>): Promise<void> {
    try {
        await pending;
    } catch {}
}

async function disposeInvocation(invocation: ProcessInvocation): Promise<void> {
    const pending = invocation.pending.read();
    if (pending !== null && invocation.state.read() !== 'complete') {
        invocation.controller.abort(new MeasurementContractError('Process sample was not awaited.', {}));
        invocation.input.helper().cancel();
        await stopPending(pending);
    }
    invocation.state.write('closed');
    const failure = invocation.cleanupFailure.read();
    if (failure !== null) {
        throw new MeasurementContractError('Benchmark process cleanup failed.', { cause: failure });
    }
}

export function createProcessInvocation(input: ProcessInvocationInput): ProcessSampleLifetime {
    const controller = new AbortController();
    const invocation: ProcessInvocation = {
        input,
        controller,
        signal: AbortSignal.any([ input.signal, controller.signal ]),
        state: createStoredValue<InvocationState>('open'),
        pending: createStoredValue<Promise<MeasuredProcess> | null>(null),
        cleanupFailure: createStoredValue<string | null>(null),
        contractFailure: createStoredValue(false)
    };
    return {
        sample: {
            async process(request) {
                return await runInvocation(invocation, request);
            }
        },
        ensureMeasured() {
            ensureMeasured(invocation);
        },
        async dispose() {
            await disposeInvocation(invocation);
        }
    };
}
