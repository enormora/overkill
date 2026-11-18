import { Transform, type Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import { createJsonFrameLimiter } from '../json-frame-limiter.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { microsecondsPerMillisecond, nanosecondsPerMicrosecond } from './measurement-units.ts';

const tokenBytes = 24;
const maximumFrameBytes = 65_536;
const reportSchema = z.strictObject({
    kind: z.literal('imported'),
    token: z.string(),
    url: z.string(),
    durationMicroseconds: z.number().nonnegative(),
    failure: z.string().nullable(),
    nodeVersion: z.string(),
    nodeArguments: z.array(z.string())
});
const messageSchema = z.union([ z.strictObject({ kind: z.literal('ready'), token: z.string() }), reportSchema ]);
type ModuleImportReport = ReadonlyDeep<z.infer<typeof reportSchema>>;
type ImportReply = {
    readonly kind: 'failed';
    readonly error: unknown;
} | { readonly kind: 'report'; readonly report: ModuleImportReport; };
type ModuleImportServer = {
    readonly listening: boolean;
    readonly once: (event: 'error', listener: (error: Error) => void) => unknown;
    readonly listen: (port: number, host: string, ready: () => void) => unknown;
    readonly address: () => string | { readonly port: number; } | null;
    readonly close: (closed: (error: Error | undefined) => void) => unknown;
};
export type ModuleImportRuntime = {
    readonly token: () => string;
    readonly now: () => bigint;
    readonly server: (accept: (socket: Duplex) => void) => ModuleImportServer;
};
type ModuleMessages = {
    readonly now: () => bigint;
    readonly token: string;
    readonly sockets: ReadonlySet<Duplex>;
    readonly addSocket: (socket: Duplex) => void;
    readonly reply: Readonly<PromiseWithResolvers<ImportReply>>;
    readonly progress: StoredValue<{
        readonly stage: 'complete' | 'ready' | 'waiting';
        readonly started: bigint;
        readonly startup: number;
    }>;
};
export type ModuleImportSession = {
    readonly arguments: readonly string[];
    readonly start: () => void;
    readonly report: () => Promise<ModuleImportReport>;
    readonly startupMilliseconds: () => number;
    readonly close: () => Promise<void>;
};

function acceptReady(messages: ModuleMessages, socket: Duplex): void {
    const previous = messages.progress.read();
    if (previous.stage !== 'waiting') {
        throw new Error('Module import became ready more than once.');
    }
    messages.progress.write({
        ...previous,
        stage: 'ready',
        startup: Number(messages.now() - previous.started) /
            (nanosecondsPerMicrosecond * microsecondsPerMillisecond)
    });
    socket.write('import\n');
}

function receiveMessage(messages: ModuleMessages, socket: Duplex, line: string): void {
    const message = messageSchema.parse(JSON.parse(line));
    const previous = messages.progress.read();
    if (message.token !== messages.token || previous.stage === 'complete') {
        throw new Error('Invalid module import identity or duplicate reply.');
    }
    if (message.kind === 'ready') {
        acceptReady(messages, socket);
    } else {
        if (previous.stage !== 'ready') {
            throw new Error('Module import completed before readiness.');
        }
        messages.progress.write({ ...previous, stage: 'complete' });
        messages.reply.resolve({ kind: 'report', report: message });
    }
}

function observeSocket(messages: ModuleMessages, socket: Duplex): void {
    messages.addSocket(socket);
    const fail = function failed(error: unknown): void {
        messages.reply.resolve({ kind: 'failed', error });
    };
    const frames = new Transform({ transform: createJsonFrameLimiter(maximumFrameBytes, 'Module import') });
    frames.on('error', fail);
    socket.on('error', fail);
    const lines = createInterface({ input: socket.pipe(frames), crlfDelay: Number.POSITIVE_INFINITY });
    lines.on('error', fail);
    socket.once('close', function closeFrameReaders() {
        lines.close();
        frames.destroy();
    });
    lines.on('line', function received(line) {
        try {
            receiveMessage(messages, socket, line);
        } catch (error: unknown) {
            fail(error);
            socket.destroy();
        }
    });
}

async function closeServer(server: ModuleImportServer, sockets: ReadonlySet<Duplex>): Promise<void> {
    for (const socket of sockets) {
        socket.destroy();
    }
    if (!server.listening) {
        return;
    }
    await new Promise<void>(function close(resolve, reject) {
        server.close(function closed(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function boundPort(server: ModuleImportServer): number {
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Module import requires a local socket.');
    }
    return address.port;
}

async function listenForImport(server: ModuleImportServer, messages: ModuleMessages): Promise<number> {
    try {
        await new Promise<void>(function listen(resolve, reject) {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        return boundPort(server);
    } catch (error: unknown) {
        messages.reply.resolve({ kind: 'failed', error });
        try {
            await closeServer(server, messages.sockets);
        } catch (cleanupError: unknown) {
            throw new AggregateError([ error, cleanupError ], 'Module import startup and cleanup failed.', {
                cause: cleanupError
            });
        }
        throw error;
    }
}
export async function openModuleImportSession(runtime: ModuleImportRuntime): Promise<ModuleImportSession> {
    const sockets = new Set<Duplex>();
    const messages: ModuleMessages = {
        token: runtime.token(),
        now: runtime.now,
        sockets,
        addSocket(socket) {
            sockets.add(socket);
        },
        reply: Promise.withResolvers<ImportReply>(),
        progress: createStoredValue<ReturnType<ModuleMessages['progress']['read']>>({
            stage: 'waiting',
            started: 0n,
            startup: 0
        })
    };
    const server = runtime.server(observeSocket.bind(null, messages));
    const port = await listenForImport(server, messages);
    return {
        arguments: [ String(port), messages.token ],
        start() {
            messages.progress.write({ ...messages.progress.read(), started: messages.now() });
        },
        async report() {
            const reply = await messages.reply.promise;
            if (reply.kind === 'failed') {
                throw reply.error;
            }
            return reply.report;
        },
        startupMilliseconds() {
            return messages.progress.read().startup;
        },
        async close() {
            messages.reply.resolve({
                kind: 'failed',
                error: new Error('Module import session closed before reporting.')
            });
            await closeServer(server, messages.sockets);
        }
    };
}

export async function createModuleImportSession(): Promise<ModuleImportSession> {
    return await openModuleImportSession({
        token() {
            return randomBytes(tokenBytes).toString('hex');
        },
        now: process.hrtime.bigint,
        server: createServer
    });
}
