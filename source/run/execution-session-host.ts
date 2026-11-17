import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { executionHostRequestSchema, executionReplySchema } from './execution-session-schema.ts';
import { parseFrozenMicrotestPolicy } from './frozen-run-policy.ts';
import type { RunExecutionSessionOptions } from './run-types.ts';
import type { ExecutionSessionEnvironment } from './execution-session-runtime-types.ts';

export type ExecutionHostRuntime = {
    readonly receive: () => Promise<unknown>;
    readonly send: (message: Readonly<Record<string, unknown>>) => Promise<void>;
    readonly disconnect: () => void;
    readonly create: (options: RunExecutionSessionOptions) => ExecutionSessionEnvironment;
};
async function receiveExecutionRequest(
    runtime: ExecutionHostRuntime
): Promise<ReturnType<typeof executionHostRequestSchema.parse>> {
    try {
        return executionHostRequestSchema.parse(await runtime.receive());
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error('Invalid execution host request.', { cause: error });
    }
}
export async function serveExecutionSessionHost(runtime: ExecutionHostRuntime): Promise<void> {
    const input = await receiveExecutionRequest(runtime);
    const environment = runtime.create({
        command: {
            kind: 'frozen-policy',
            policy: parseFrozenMicrotestPolicy(input.policy),
            invocation: { seed: input.seed, selection: input.selection },
            reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
        },
        environment: 'profile-default',
        lifecycle: input.transport.lifecycle
    });
    const cancellation = new AbortController();
    const reply = executionReplySchema.parse(
        await environment.execute({
            transport: input.transport,
            timeoutMilliseconds: input.timeoutMilliseconds,
            signal: cancellation.signal,
            async checkpoint(data) {
                await runtime.send({ kind: 'execution-checkpoint', data });
            }
        })
    );
    await runtime.send(reply);
    runtime.disconnect();
}
