import { runExecutionLifecycle } from '../run/execution-session-lifecycle.ts';
import { createCollectedSession } from '../run/execution-session-collected.ts';
import type { CollectedRun } from '../run/run-types.ts';
import type { ExecutionSessionCall, ExecutionSessionEnvironment } from '../run/execution-session-runtime-types.ts';
import type { RunExecutionReply } from '../run/execution-session-types.ts';
import { executionLifecycle, type ExecutionLifecycleFixture } from './execution-lifecycle.ts';
import { executionSessionRuntime } from './execution-session-runtime.ts';

export type CollectedSessionFault = {
    readonly collect: Error | null;
    readonly execute: Error | null;
    readonly checkpoint: Error | null;
    readonly dispose: Error | null;
};
export const collectedSessionFault: CollectedSessionFault = {
    collect: null,
    execute: null,
    checkpoint: null,
    dispose: null
};
type CollectedSessionFixture = {
    readonly session: ExecutionSessionEnvironment;
    readonly call: ExecutionSessionCall;
    readonly collections: () => number;
    readonly runs: readonly unknown[];
    readonly lifecycle: ExecutionLifecycleFixture;
    readonly reply: Extract<RunExecutionReply, { readonly kind: 'result'; }>;
};
export async function collectedSession(fault: CollectedSessionFault): Promise<CollectedSessionFixture> {
    const fixture = await executionSessionRuntime();
    const lifecycle = executionLifecycle(fault.dispose);
    let collections = 0;
    const runs: unknown[] = [];
    const result = {
        context: { id: null, startedAt: null, facts: null },
        ...fixture.reply.result,
        maintenanceDiagnostics: [ 'maintenance' ]
    };
    async function run(invocation: Parameters<CollectedRun['run']>[0]): ReturnType<CollectedRun['run']> {
        runs.push(invocation);
        if (fault.execute !== null) {
            throw fault.execute;
        }
        return result;
    }
    const session = createCollectedSession(fixture.options, {
        async collect() {
            collections += 1;
            if (fault.collect !== null) {
                throw fault.collect;
            }
            return { plan: lifecycle.plan, run };
        },
        async lifecycle(transport, boundary, observation, operation) {
            return await runExecutionLifecycle({ transport, boundary, observation, load: lifecycle.load }, operation);
        }
    });
    return {
        session,
        collections() {
            return collections;
        },
        runs,
        lifecycle,
        reply: fixture.reply,
        call: {
            transport: lifecycle.transport,
            timeoutMilliseconds: 50,
            signal: lifecycle.controller.signal,
            async checkpoint(data) {
                if (fault.checkpoint !== null) {
                    throw fault.checkpoint;
                }
                await lifecycle.observation.checkpoint(data);
            }
        }
    };
}
