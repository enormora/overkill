import { fileURLToPath } from 'node:url';
import { createStoredValue, type StoredValue } from '../../stored-value.ts';
import { executeProcessCommand } from '../../bench/process-execution.ts';
import {
    processHelperRequestSchema,
    type ProcessHelperReply,
    type ProcessHelperRequest
} from '../../bench/process-protocol.ts';

export const processHelperEntryPointUrl = new URL(import.meta.url);
type ProcessRunRequest = Extract<ProcessHelperRequest, { readonly kind: 'run'; }>;
type ProcessHost = {
    readonly running: StoredValue<Promise<void> | null>;
    readonly controller: StoredValue<AbortController | null>;
};

function sendReply(reply: ProcessHelperReply): void {
    if (process.connected) {
        process.send?.(reply, function disconnectMissingOwner(error) {
            if (error !== null && process.connected) {
                process.disconnect?.();
            }
        });
    }
}

async function shutdownHost(host: ProcessHost): Promise<void> {
    host.controller.read()?.abort(new Error('Process helper owner disconnected.'));
    await host.running.read();
    process.removeAllListeners('message');
    process.removeAllListeners('disconnect');
    if (process.connected) {
        process.disconnect?.();
    }
}

async function executeHostedCommand(host: ProcessHost, message: ProcessRunRequest, signal: AbortSignal): Promise<void> {
    try {
        const execution = await executeProcessCommand({
            ...message,
            signal,
            environment: process.env,
            started(pid) {
                sendReply({ kind: 'started', id: message.id, pid });
            }
        });
        sendReply({ kind: 'complete', id: message.id, execution });
    } finally {
        host.running.write(null);
        host.controller.write(null);
    }
}

function receiveHostCommand(host: ProcessHost, message: ProcessHelperRequest): void {
    if (message.kind === 'close') {
        host.running.write(shutdownHost(host));
    } else if (message.kind === 'cancel') {
        host.controller.read()?.abort(new Error('Process sample was cancelled.'));
    } else {
        if (host.running.read() !== null) {
            throw new Error('Process helper received overlapping invocations.');
        }
        const controller = new AbortController();
        host.controller.write(controller);
        host.running.write(executeHostedCommand(host, message, controller.signal));
    }
}

function startProcessHost(): void {
    const host: ProcessHost = {
        running: createStoredValue<Promise<void> | null>(null),
        controller: createStoredValue<AbortController | null>(null)
    };
    process.once('disconnect', function () {
        host.running.write(shutdownHost(host));
    });
    process.on('message', function (value) {
        receiveHostCommand(host, processHelperRequestSchema.parse(value));
    });
    sendReply({ kind: 'ready', version: 1 });
}

if (process.argv[1] === fileURLToPath(processHelperEntryPointUrl)) {
    startProcessHost();
}
