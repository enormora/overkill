import { EventEmitter } from 'node:events';
import type { LocalHttpServer } from '../resources/local-http-service-resource.ts';

export type HttpServerFaults = {
    readonly listen: Error | null;
    readonly close: Error | null;
    readonly address: 'none' | 'string' | 'tcp';
};
export type LocalHttpServerFixture = {
    readonly server: LocalHttpServer;
    readonly calls: readonly string[];
    readonly events: EventEmitter;
};
export function localHttpServer(faults: HttpServerFaults): LocalHttpServerFixture {
    const events = new EventEmitter();
    const calls: string[] = [];
    const state = { listening: false };
    const server = {
        get listening() {
            return state.listening;
        },
        address() {
            if (faults.address === 'tcp') {
                return { port: 4321 };
            }
            return faults.address === 'string' ? 'pipe' : null;
        },
        once: events.once.bind(events),
        off: events.off.bind(events),
        listen(port: number, host: string) {
            calls.push(`listen:${host}:${port}`);
            state.listening = faults.listen === null;
            events.emit(faults.listen === null ? 'listening' : 'error', faults.listen);
        },
        close(callback: (error: Error | undefined) => void) {
            calls.push('close');
            state.listening = false;
            callback(faults.close ?? undefined);
        }
    };
    return { server, calls, events };
}
