import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import { connectProcessHelper, type ProcessHelper } from '../bench/process-helper.ts';
import type { ProcessCommand } from '../bench/process-command.ts';
import type { ProcessExecution } from '../bench/process-protocol.ts';
import { processOutput } from '../bench/process-output.ts';
import { processHelperChannel, type ProcessHelperChannel, type ProcessHelperFaults } from './process-helper-channel.ts';

const maximumOutputBytes = 4096;
type MemoryProcessHelper = ProcessHelperChannel & {
    readonly helper: ProcessHelper;
    readonly clock: DeterministicClock;
    readonly groups: readonly { readonly pid: number | null; readonly signal: string; }[];
    readonly deadlines: readonly number[];
};
export const helperCommand: Extract<ProcessCommand, { readonly kind: 'pipes'; }> = {
    kind: 'pipes',
    command: [ 'service' ],
    cwd: '/project',
    env: null,
    completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
};
export const failedProcessExecution: ProcessExecution = {
    status: 'failed',
    message: 'Target failed.',
    output: processOutput('pipes', 0).snapshot(),
    cleanupFailure: null
};
export function memoryProcessHelper(
    ready: boolean,
    faults: ProcessHelperFaults
): MemoryProcessHelper {
    const channel = processHelperChannel(faults);
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const groups: { readonly pid: number | null; readonly signal: string; }[] = [];
    const deadlines: number[] = [];
    const helper = connectProcessHelper('off', maximumOutputBytes, {
        connect() {
            return channel.child;
        },
        schedule(callback, milliseconds) {
            const timer = clock.setTimeout(callback, milliseconds);
            return function () {
                clock.clearTimeout(timer);
            };
        },
        signalGroup(pid, signal) {
            groups.push({ pid, signal });
            if (faults.group !== null) {
                throw faults.group;
            }
        },
        async deadline(pending, milliseconds) {
            deadlines.push(milliseconds);
            if (faults.shutdown !== null) {
                throw faults.shutdown;
            }
            return await pending;
        }
    });
    if (ready) {
        channel.events.emit('message', { kind: 'ready', version: 1 });
    }
    return { ...channel, helper, clock, groups, deadlines };
}
