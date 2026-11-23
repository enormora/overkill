import { BroadcastChannel as NodeBroadcastChannel, receiveMessageOnPort } from 'node:worker_threads';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import { lateAssertionDiagnosticId } from '../engine/assertion-lifetime.ts';
import { runnerErrorSchema } from '../engine/runner-error-schema.ts';
import type { RunnerError } from '../engine/run-result.ts';

function channelName(token: string): string {
    return `overkill:late-assertions:${token}`;
}

export function sendWorkerLateAssertion(token: string, error: RunnerError): void {
    const channel = withRunnerInfrastructure(function createDiagnosticChannel() {
        return new NodeBroadcastChannel(channelName(token));
    });
    try {
        // eslint-disable-next-line unicorn/require-post-message-target-origin -- Node BroadcastChannel only accepts the message.
        channel.postMessage(error);
    } finally {
        channel.close();
    }
}

export type WorkerLateAssertionObserver = { readonly close: () => Promise<void>; };
export function observeWorkerLateAssertions(
    token: string,
    receive: (error: RunnerError) => void
): WorkerLateAssertionObserver {
    const channel = withRunnerInfrastructure(function createDiagnosticChannel() {
        return new NodeBroadcastChannel(channelName(token));
    });
    channel.unref();

    function report(input: unknown): void {
        const parsed = runnerErrorSchema.safeParse(input);
        if (parsed.success && lateAssertionDiagnosticId(parsed.data) !== null) {
            receive(parsed.data);
        }
    }

    channel.addEventListener('message', function receiveDiagnostic(event) {
        report(event.data);
    });
    return {
        async close() {
            await waitForImmediate();
            for (;;) {
                const received: unknown = Reflect.apply(receiveMessageOnPort, undefined, [ channel ]);
                if (typeof received !== 'object' || received === null) {
                    break;
                }
                report(Reflect.get(received, 'message'));
            }
            channel.close();
        }
    };
}
