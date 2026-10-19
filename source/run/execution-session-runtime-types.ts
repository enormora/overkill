import type { JsonValue } from 'type-fest';
import type { RunExecutionReply } from './execution-session-types.ts';
import type { RunExecutionTransport } from './execution-session-context.ts';

export type ExecutionSessionObservation = {
    readonly signal: AbortSignal;
    readonly checkpoint: (data: JsonValue) => Promise<void>;
};

export type ExecutionSessionCall = ExecutionSessionObservation & {
    readonly transport: RunExecutionTransport;
    readonly timeoutMilliseconds: number;
};
export type ExecutionSessionEnvironment = {
    readonly lifetime: 'fresh' | 'reused';
    readonly execute: (call: ExecutionSessionCall) => Promise<RunExecutionReply>;
};
