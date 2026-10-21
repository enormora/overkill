import type { JsonValue } from 'type-fest';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { RunResult, RunnerError } from './run-engine-primitives.ts';

type ExecutionFailureDetails = {
    readonly name: string;
    readonly message: string;
    readonly cause: unknown;
    readonly stack: string | null;
};
type ExecutionFailureKind = {
    readonly kind: 'collection-error';
    readonly errors: NonEmptyReadonlyArray<RunnerError>;
} | {
    readonly kind: 'config-error';
} | {
    readonly kind: 'error';
} | {
    readonly kind: 'resolution-error';
    readonly code: 'invalid-request' | 'no-tests-collected' | 'unsupported-request';
};

export type RunExecutionFailure = ExecutionFailureDetails & ExecutionFailureKind;

export type RunExecutionInvocation = {
    readonly data: JsonValue;
    readonly timeoutMilliseconds: number;
    readonly signal: AbortSignal | null;
};
export type RunExecutionReply = {
    readonly kind: 'failure';
    readonly failure: RunExecutionFailure;
    readonly artifacts: RunResult['artifacts'];
    readonly data: JsonValue;
} | {
    readonly kind: 'result';
    readonly result: RunResult;
    readonly data: JsonValue;
    readonly deadlineExceeded: boolean;
} | {
    readonly kind: 'timeout';
    readonly artifacts: RunResult['artifacts'];
    readonly data: JsonValue;
};
export type RunExecutionSession = {
    readonly environmentLifetime: 'fresh' | 'reused';
    readonly run: (invocation: RunExecutionInvocation) => Promise<RunExecutionReply>;
    readonly dispose: () => Promise<void>;
};
