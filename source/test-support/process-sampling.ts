import type { ProcessPhase } from '../bench/process-evidence.ts';
import type { MeasuredProcess } from '../bench/process-observation.ts';
import { openProcessSamplingSession, type ProcessSamplingSession } from '../bench/process-sampling.ts';
import type { ProcessInstrumentation } from '../bench/process-measurement.ts';
import type { ProcessRequest } from '../bench/process-command.ts';
import { failedProcessExecution, helperCommand } from './memory-process-helper.ts';

type SamplingFixture = {
    readonly session: ProcessSamplingSession;
    readonly measure: (phase: ProcessPhase) => Promise<MeasuredProcess>;
    readonly request: ProcessRequest;
    readonly created: readonly { readonly instrumentation: ProcessInstrumentation; readonly maximumBytes: number; }[];
    readonly calls: readonly string[];
};
export function processSampling(platform: string, signal: AbortSignal, closeFailure: Error | null): SamplingFixture {
    const created: { readonly instrumentation: ProcessInstrumentation; readonly maximumBytes: number; }[] = [];
    const calls: string[] = [];
    const { kind, ...command } = helperCommand;
    const session = openProcessSamplingSession({ mode: 'process', instrumentation: 'off' }, signal, {
        platform,
        helper(instrumentation, maximumBytes) {
            created.push({ instrumentation, maximumBytes });
            return {
                async run() {
                    calls.push('run');
                    return failedProcessExecution;
                },
                cancel() {
                    calls.push('cancel');
                },
                async close() {
                    calls.push('close');
                    if (closeFailure !== null) {
                        throw closeFailure;
                    }
                }
            };
        }
    });
    const request: ProcessRequest = { ...command, io: { kind } };
    return {
        session,
        request,
        created,
        calls,
        async measure(phase) {
            const sample = session.sample(phase);
            try {
                return await sample.sample.process(request);
            } finally {
                await sample.dispose();
            }
        }
    };
}
