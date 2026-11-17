import { type DeterministicClock, createDeterministicClock } from '@enormora/clock';

import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import type { RunExecutionSessionOptions } from '../run/run-types.ts';
import type { ExecutionSessionRuntime } from '../run/execution-session.ts';
import type { ExecutionSessionCall, ExecutionSessionEnvironment } from '../run/execution-session-runtime-types.ts';
import type { RunExecutionReply } from '../run/execution-session-types.ts';
import { baselineCaseResult } from './baseline-case-fixture.ts';
import { frozenMicrotestPolicy } from './frozen-microtest-policy.ts';

const sessionSeed = 42n;
type ExecutionSessionFixture = {
    readonly clock: DeterministicClock;
    readonly calls: readonly ExecutionSessionCall[];
    readonly initialized: readonly RunExecutionSessionOptions[];
    readonly options: RunExecutionSessionOptions;
    readonly environment: ExecutionSessionEnvironment;
    readonly runtime: ExecutionSessionRuntime;
    readonly reply: Extract<RunExecutionReply, { readonly kind: 'result'; }>;
};
export async function executionSessionRuntime(): Promise<ExecutionSessionFixture> {
    const policy = await frozenMicrotestPolicy();
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const calls: ExecutionSessionCall[] = [];
    const initialized: RunExecutionSessionOptions[] = [];
    const options: RunExecutionSessionOptions = {
        environment: 'profile-default',
        lifecycle: { moduleUrl: 'file:///project/lifecycle.ts', exportName: 'create' },
        command: {
            kind: 'frozen-policy',
            policy,
            invocation: { seed: { value: sessionSeed }, selection: { kind: 'all' } },
            reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
        }
    };
    const reply: RunExecutionReply = {
        kind: 'result',
        result: baselineCaseResult,
        data: null,
        deadlineExceeded: false
    };
    const environment: ExecutionSessionEnvironment = {
        lifetime: 'reused',
        async execute(call) {
            calls.push(call);
            return { ...reply, data: call.transport.data };
        }
    };
    const runtime: ExecutionSessionRuntime = {
        wallClock: clock,
        createSeed() {
            return sessionSeed;
        },
        async initialize(input) {
            initialized.push(input);
            return environment;
        }
    };
    return { clock, calls, initialized, options, environment, runtime, reply };
}
