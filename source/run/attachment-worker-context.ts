import type { AttachmentConnection } from './attachment-connection.ts';
import type { AttachmentExecution } from './attachment-execution.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';
import type { AttachmentEndpoint } from './attachment-protocol.ts';

type WorkerAttachmentSession = { readonly connection: AttachmentConnection; readonly execution: AttachmentExecution; };
const workerSessions = new Map<string, Promise<WorkerAttachmentSession>>();
async function createWorkerAttachmentSession(endpoint: AttachmentEndpoint): Promise<WorkerAttachmentSession> {
    const { createAttachmentConnection } = await import('./attachment-connection.ts');
    const { createAttachmentExecution } = await import('./attachment-execution.ts');
    const connection = createAttachmentConnection(endpoint);
    return { connection, execution: createAttachmentExecution(connection.exchange, endpoint.limits) };
}
async function observeWorkerAttachmentSession(
    key: string,
    pending: Promise<WorkerAttachmentSession>
): Promise<WorkerAttachmentSession> {
    try {
        const session = await pending;
        session.connection.observeDisconnect(function forgetDisconnectedAttachmentSession() {
            if (workerSessions.get(key) === pending) {
                workerSessions.delete(key);
            }
        });
        return session;
    } catch (error: unknown) {
        if (workerSessions.get(key) === pending) {
            workerSessions.delete(key);
        }
        throw error;
    }
}
async function workerAttachmentSession(
    endpoint: AttachmentEndpoint | null,
    lifecycle: string | null
): Promise<WorkerAttachmentSession | null> {
    const key = lifecycle ?? endpoint?.token ?? '';
    const existing = workerSessions.get(key);
    if (existing !== undefined) {
        return existing;
    }
    if (endpoint === null) {
        return null;
    }
    const pending = createWorkerAttachmentSession(endpoint);
    workerSessions.set(key, pending);
    return await observeWorkerAttachmentSession(key, pending);
}
export async function runWithWorkerAttachments<Value>(
    endpoint: AttachmentEndpoint | null,
    lifecycle: string | null,
    run: () => Promise<Value>
): Promise<Value> {
    const session = await workerAttachmentSession(endpoint, lifecycle);
    if (session === null) {
        return await run();
    }
    await session.connection.ready;
    return await session.execution.runBranch(endpoint?.branch ?? null, async function executeAttachmentBranch() {
        return await runWithAttachmentExecution(session.execution, run);
    });
}
