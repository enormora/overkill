import { EventEmitter } from 'node:events';
import type { FreshExecutionRequest, FreshExecutionFactory } from '../run/execution-session-process.ts';
import { executionSessionRuntime } from './execution-session-runtime.ts';

type FreshHostFault = 'checkpoint' | 'checkpoint-failure' | 'error' | 'exit' | 'invalid' | 'none' | 'send';
type FreshHostFixture = {
    readonly request: FreshExecutionRequest;
    readonly start: FreshExecutionFactory;
    readonly events: readonly string[];
    readonly sent: readonly Readonly<Record<string, unknown>>[];
    readonly failure: Error;
};
function failFreshHost(emitter: EventEmitter, fault: FreshHostFault, failure: Error): boolean {
    if (fault === 'exit') {
        emitter.emit('exit', 1, null);
        return true;
    }
    if (fault === 'error') {
        emitter.emit('error', failure);
        return true;
    }
    if (fault === 'invalid') {
        emitter.emit('message', {});
        return true;
    }
    return false;
}
export async function freshExecutionHost(fault: FreshHostFault): Promise<FreshHostFixture> {
    const fixture = await executionSessionRuntime();
    const { command, lifecycle } = fixture.options;
    const events: string[] = [];
    const sent: Record<string, unknown>[] = [];
    const emitter = new EventEmitter();
    const failure = new Error('fresh host failed');
    return {
        events,
        sent,
        failure,
        request: {
            command,
            transport: { lifecycle, data: { value: 42 } },
            timeoutMilliseconds: 10,
            observation: {
                signal: AbortSignal.any([]),
                async checkpoint() {
                    events.push('checkpoint');
                    if (fault === 'checkpoint-failure') {
                        throw failure;
                    }
                }
            }
        },
        start() {
            events.push('start');
            const closed = Promise.withResolvers<undefined>();
            return {
                closed: closed.promise,
                pending: new Set(),
                child: {
                    on: emitter.on.bind(emitter),
                    once: emitter.once.bind(emitter),
                    send(message, callback) {
                        events.push('send');
                        sent.push(message);
                        callback(fault === 'send' ? failure : null);
                        if (!failFreshHost(emitter, fault, failure) && fault !== 'send') {
                            if ([ 'checkpoint', 'checkpoint-failure' ].includes(fault)) {
                                emitter.emit('message', { kind: 'execution-checkpoint', data: { progress: 1 } });
                            }
                            emitter.emit('message', fixture.reply);
                        }
                        return true;
                    },
                    kill(signal) {
                        events.push(signal);
                        closed.resolve(undefined);
                        return true;
                    }
                }
            };
        }
    };
}
