import { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';
import { openProcessProbe, type ProcessProbeRuntime } from '../bench/process-probe-session.ts';
import { unavailableChildMetrics, type NodeProbeReport } from '../bench/process-node-readings.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';

type ProbeChannelScenario = {
    readonly snapshotTimeout: boolean;
    readonly listenError: Error | null;
    readonly closeError: Error | null;
    readonly address: string | { readonly port: number; } | null;
};
export const probeChannelScenario: ProbeChannelScenario = {
    snapshotTimeout: false,
    listenError: null,
    closeError: null,
    address: { port: 4321 }
};
type ProbeChannel = {
    readonly probe: Awaited<ReturnType<typeof openProcessProbe>>;
    readonly socket: Duplex;
    readonly report: NodeProbeReport;
    readonly events: readonly string[];
    readonly deliver: (value: unknown) => void;
};
export async function processProbeChannel(scope: TestScope, input: ProbeChannelScenario): Promise<ProbeChannel> {
    const emitter = new EventEmitter();
    const events: string[] = [];
    const socket = new Duplex({
        read() {
            return undefined;
        },
        write(chunk: Buffer, _encoding, callback) {
            events.push(chunk.toString());
            callback();
        }
    });
    const report: NodeProbeReport = {
        version: 1,
        runtime: 'unit-node',
        observationMicroseconds: 42,
        metrics: unavailableChildMetrics('unit-probe')
    };
    const state = { listening: false, deadlines: 0 };
    const runtime: ProcessProbeRuntime = {
        async report() {
            return {
                path: '/unit-report.json',
                async read() {
                    events.push('read');
                    return report;
                },
                async dispose() {
                    events.push('dispose-report');
                }
            };
        },
        token() {
            return 'unit-probe-token';
        },
        server() {
            return {
                get listening() {
                    return state.listening;
                },
                on: emitter.on.bind(emitter),
                once: emitter.once.bind(emitter),
                listen(_port, _host, ready) {
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
                    state.listening = false;
                    events.push('close');
                    closed(input.closeError ?? undefined);
                }
            };
        },
        async deadline(pending, _milliseconds, message) {
            state.deadlines += 1;
            return input.snapshotTimeout && state.deadlines === 1
                ? await Promise.race([ pending, Promise.reject(new Error(message)) ])
                : await pending;
        }
    };
    scope.cleanup(function releaseProbeChannel() {
        socket.destroy();
    });
    const probe = await openProcessProbe(runtime);
    emitter.emit('connection', socket);
    return {
        probe,
        socket,
        report,
        events,
        deliver(value) {
            socket.push(`${JSON.stringify(value)}\n`);
        }
    };
}
