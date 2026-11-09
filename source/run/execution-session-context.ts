import { AsyncLocalStorage } from 'node:async_hooks';
import type { JsonValue } from 'type-fest';
import type { SnapshotRun } from './snapshot-wire.ts';
import type { RunExecutionLifecycleReference } from './run-request-types.ts';

export type RunExecutionTransport = {
    readonly lifecycle: RunExecutionLifecycleReference;
    readonly data: JsonValue;
};

const execution = new AsyncLocalStorage<RunExecutionTransport>();
export const currentExecutionSession = function (): RunExecutionTransport | null {
    return execution.getStore() ?? null;
};
export async function withExecutionSession<Value>(
    transport: RunExecutionTransport,
    run: () => Promise<Value>
): Promise<Value> {
    return await execution.run(transport, run);
}

const runs = new AsyncLocalStorage<SnapshotRun>();

export function currentSnapshotRun(): SnapshotRun | null {
    return runs.getStore() ?? null;
}

export async function runWithSnapshotRun<Value>(wire: SnapshotRun | null, run: () => Promise<Value>): Promise<Value> {
    return wire === null ? await run() : await runs.run(wire, run);
}
