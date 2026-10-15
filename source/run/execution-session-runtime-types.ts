import type { RunExecutionReply } from './execution-session-types.ts';
import type { RunExecutionTransport } from './execution-session-context.ts';

export type ExecutionSessionCall = {
    readonly transport: RunExecutionTransport;
    readonly timeoutMilliseconds: number;
    readonly signal: AbortSignal;
};
export type ExecutionSessionEnvironment = {
    readonly lifetime: 'fresh' | 'reused';
    readonly execute: (call: ExecutionSessionCall) => Promise<RunExecutionReply>;
};
