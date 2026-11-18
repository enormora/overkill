import type { ExecutionHostRuntime } from '../run/execution-session-host.ts';
import type { RunExecutionSessionOptions } from '../run/run-types.ts';
import { executionSessionRuntime } from './execution-session-runtime.ts';

type ExecutionHostFault = 'checkpoint' | 'execute' | 'none' | 'reply' | 'request';
type ExecutionHostFixture = {
    readonly runtime: ExecutionHostRuntime;
    readonly messages: readonly unknown[];
    readonly initialized: readonly RunExecutionSessionOptions[];
    readonly events: readonly string[];
    readonly request: unknown;
    readonly failure: Error;
};
export async function executionHost(fault: ExecutionHostFault): Promise<ExecutionHostFixture> {
    const fixture = await executionSessionRuntime();
    const { command, lifecycle } = fixture.options;
    const request = {
        policy: command.policy,
        ...command.invocation,
        transport: { lifecycle, data: { value: 42 } },
        timeoutMilliseconds: 10
    };
    const messages: unknown[] = [];
    const initialized: RunExecutionSessionOptions[] = [];
    const events: string[] = [];
    const failure = new Error('host failed');
    return {
        request,
        messages,
        initialized,
        events,
        failure,
        runtime: {
            async receive() {
                return fault === 'request' ? {} : request;
            },
            async send(message) {
                events.push('send');
                messages.push(message);
                if (fault === 'checkpoint' || fault === 'reply' && messages.length > 1) {
                    throw failure;
                }
            },
            disconnect() {
                events.push('disconnect');
            },
            create(options) {
                initialized.push(options);
                return {
                    lifetime: 'fresh',
                    async execute(call) {
                        events.push('execute');
                        await call.checkpoint({ progress: 1 });
                        if (fault === 'execute') {
                            throw failure;
                        }
                        return { ...fixture.reply, data: call.transport.data };
                    }
                };
            }
        }
    };
}
