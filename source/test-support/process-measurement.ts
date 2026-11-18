import type { ProcessExecutionInput, ProcessExecutionRuntime } from '../bench/process-execution.ts';
import { createStoredValue } from '../stored-value.ts';
import type { ProcessExit, ProcessLaunch } from '../bench/process-child.ts';
import { unavailableChildMetrics, type NodeProbeReport } from '../bench/process-node-readings.ts';

export type ProcessMeasurementScenario = {
    readonly launchError: Error | null;
    readonly exitError: Error | null;
    readonly disposeError: Error | null;
    readonly probeError: Error | null;
    readonly probeDisposeError: Error | null;
    readonly exitCode: number;
    readonly pid: number | null;
    readonly active: boolean;
};
export const processMeasurementScenario: ProcessMeasurementScenario = {
    launchError: null,
    exitError: null,
    disposeError: null,
    probeError: null,
    probeDisposeError: null,
    exitCode: 0,
    pid: 42,
    active: false
};
type PipeExecutionInput = ProcessExecutionInput & {
    readonly request: Extract<ProcessExecutionInput['request'], { readonly kind: 'pipes'; }>;
};
type ProcessMeasurement = {
    readonly request: PipeExecutionInput;
    readonly runtime: ProcessExecutionRuntime;
    readonly events: readonly string[];
    readonly launched: readonly ProcessLaunch[];
    readonly report: NodeProbeReport;
    readonly controller: AbortController;
};
const measurementStartedNanoseconds = 100_000n;
function completeScriptedExit(
    exit: Readonly<PromiseWithResolvers<ProcessExit>>,
    input: ProcessMeasurementScenario
): void {
    if (input.active) {
        return;
    }
    if (input.exitError === null) {
        exit.resolve({ code: input.exitCode, signal: null, time: 200_000n });
    } else {
        exit.reject(input.exitError);
    }
}
export function processMeasurement(input: ProcessMeasurementScenario): ProcessMeasurement {
    const events: string[] = [];
    const launched: ProcessLaunch[] = [];
    const controller = new AbortController();
    const exited = createStoredValue<Readonly<PromiseWithResolvers<ProcessExit>> | null>(null);
    const report: NodeProbeReport = {
        version: 1,
        runtime: 'unit-node',
        observationMicroseconds: 200,
        metrics: unavailableChildMetrics('unit probe')
    };
    const request: PipeExecutionInput = {
        request: {
            kind: 'pipes',
            command: [ 'unit-command', 'argument' ],
            cwd: '/project',
            env: null,
            completion: { kind: 'exit', expectedExitCodes: [ 0 ], steps: [], readiness: null }
        },
        instrumentation: 'off',
        maximumBytes: 1024,
        signal: controller.signal,
        environment: { UNIT: 'environment' },
        started(pid) {
            events.push(`started:${pid}`);
        }
    };
    const runtime: ProcessExecutionRuntime = {
        async prepare() {
            events.push('prepare');
            return function launch(command) {
                if (input.launchError !== null) {
                    throw input.launchError;
                }
                const exit = Promise.withResolvers<ProcessExit>();
                exited.write(exit);
                launched.push(command);
                command.output.append('stdout', Buffer.from('ready\n'));
                completeScriptedExit(exit, input);
                return {
                    pid: input.pid,
                    exit: exit.promise,
                    closed: Promise.resolve(),
                    async write(text) {
                        events.push(text);
                    },
                    closeInput() {
                        events.push('close-input');
                    },
                    resize(columns, rows) {
                        events.push(`${columns}x${rows}`);
                    }
                };
            };
        },
        async probe() {
            events.push('probe');
            if (input.probeError !== null) {
                throw input.probeError;
            }
            return {
                arguments: [ '--unit-probe' ],
                environment: { PROBE: 'on' },
                identify(pid) {
                    events.push(`identified:${pid}`);
                },
                async finalSnapshot() {
                    events.push('final');
                    return report;
                },
                async checkpointSnapshot() {
                    events.push('checkpoint');
                    return report;
                },
                async dispose() {
                    events.push('probe-dispose');
                    if (input.probeDisposeError !== null) {
                        throw input.probeDisposeError;
                    }
                }
            };
        },
        async dispose() {
            events.push('dispose');
            exited.read()?.resolve({ code: 0, signal: null, time: 300_000n });
            if (input.disposeError !== null) {
                throw input.disposeError;
            }
        },
        now() {
            return measurementStartedNanoseconds;
        }
    };
    return { request, runtime, events, launched, report, controller };
}
