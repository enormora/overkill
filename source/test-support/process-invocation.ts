import { createProcessInvocation, type ProcessSampleLifetime } from '../bench/process-invocation.ts';
import { measureProcessCommand } from '../bench/process-execution.ts';
import type { ProcessCommand, ProcessRequest } from '../bench/process-command.ts';
import type { ProcessExecution } from '../bench/process-protocol.ts';
import { processMeasurement, processMeasurementScenario } from './process-measurement.ts';
import { failedProcessExecution } from './memory-process-helper.ts';

export type InvocationScenario = 'cleanup' | 'failure' | 'pass' | 'pending';
type InvocationFixture = {
    readonly invocation: ProcessSampleLifetime;
    readonly request: ProcessRequest;
    readonly calls: readonly ProcessCommand[];
    readonly observations: readonly ProcessExecution[];
    readonly ready: Promise<void>;
};
async function interruptedProcess(signal: AbortSignal): Promise<ProcessExecution> {
    return new Promise(function (_resolve, reject) {
        signal.addEventListener('abort', function () {
            const reason: unknown = signal.reason;
            reject(reason instanceof Error ? reason : new Error('Process cancelled.', { cause: reason }));
        }, { once: true });
    });
}
export async function processInvocation(scenario: InvocationScenario, signal: AbortSignal): Promise<InvocationFixture> {
    const measurement = processMeasurement(processMeasurementScenario);
    const execution = await measureProcessCommand(measurement.request, measurement.runtime);
    const calls: ProcessCommand[] = [];
    const observations: ProcessExecution[] = [];
    const ready = Promise.withResolvers<undefined>();
    if (scenario !== 'pending') {
        ready.resolve(undefined);
    }
    const { kind, ...request } = measurement.request.request;
    const invocation = createProcessInvocation({
        signal,
        observe(value) {
            observations.push(value);
        },
        helper() {
            return {
                async run(command, operationSignal) {
                    calls.push(command);
                    ready.resolve(undefined);
                    if (scenario === 'pending') {
                        return await interruptedProcess(operationSignal);
                    }
                    return scenario === 'failure'
                        ? failedProcessExecution
                        : { ...execution, cleanupFailure: scenario === 'cleanup' ? 'still running' : null };
                },
                cancel() {
                    return undefined;
                },
                async close() {
                    return undefined;
                }
            };
        }
    });
    return { invocation, request: { ...request, io: { kind } }, calls, observations, ready: ready.promise };
}
