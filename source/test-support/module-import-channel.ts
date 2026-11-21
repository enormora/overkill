import { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { TestScope } from '@overkill-dev/test';
import { openModuleImportSession, type ModuleImportRuntime } from '../bench/module-import-session.ts';

export type ImportChannelScenario = {
    readonly address: string | { readonly port: number; } | null;
    readonly listenError: Error | null;
    readonly closeError: Error | null;
};
export const importChannelScenario: ImportChannelScenario = {
    address: { port: 4321 },
    listenError: null,
    closeError: null
};
type ModuleImportChannel = {
    readonly session: Awaited<ReturnType<typeof openModuleImportSession>>;
    readonly socket: Duplex;
    readonly sent: readonly string[];
    readonly events: readonly string[];
    readonly deliver: (value: unknown) => void;
    readonly report: Awaited<ReturnType<Awaited<ReturnType<typeof openModuleImportSession>>['report']>>;
};
const startupStepNanoseconds = 1_000_000n;
export async function moduleImportChannel(
    cleanup: TestScope['cleanup'],
    input: ImportChannelScenario
): Promise<ModuleImportChannel> {
    const sent: string[] = [];
    const events: string[] = [];
    const emitter = new EventEmitter();
    const socket = new Duplex({
        read() {
            return undefined;
        },
        write(chunk: Buffer, _encoding, callback) {
            sent.push(chunk.toString());
            callback();
        }
    });
    const state = {
        time: 0n,
        listening: false,
        accept(incoming: Duplex): void {
            throw new Error('Import listener not initialized.', { cause: incoming });
        }
    };
    const runtime: ModuleImportRuntime = {
        token() {
            return 'unit-import-token';
        },
        now() {
            state.time += startupStepNanoseconds;
            return state.time;
        },
        server(receive) {
            state.accept = receive;
            return {
                get listening() {
                    return state.listening;
                },
                once: emitter.once.bind(emitter),
                listen(_port, host, ready) {
                    events.push(host);
                    if (input.listenError === null) {
                        state.listening = true;
                        ready();
                    } else {
                        emitter.emit('error', input.listenError);
                    }
                },
                address() {
                    return input.address;
                },
                close(closed) {
                    events.push('close');
                    state.listening = false;
                    closed(input.closeError ?? undefined);
                }
            };
        }
    };
    cleanup(function releaseImportChannel() {
        socket.destroy();
    });
    const session = await openModuleImportSession(runtime);
    state.accept(socket);
    return {
        session,
        socket,
        sent,
        events,
        deliver(value: unknown) {
            socket.push(`${JSON.stringify(value)}\n`);
        },
        report: {
            kind: 'imported',
            token: 'unit-import-token',
            url: 'file:///unit-subject.ts',
            durationMicroseconds: 7,
            failure: null,
            nodeVersion: '26.13.0',
            nodeArguments: []
        }
    };
}
