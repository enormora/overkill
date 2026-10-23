import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
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
type ModuleMessages = {
    readonly token: string;
    readonly sockets: ReadonlySet<Socket>;
    readonly addSocket: (socket: Socket) => void;
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

function acceptReady(messages: ModuleMessages, socket: Socket): void {
    const previous = messages.progress.read();
    if (previous.stage !== 'waiting') {
        throw new Error('Module import became ready more than once.');
    }
    messages.progress.write({
        ...previous,
        stage: 'ready',
        startup: Number(process.hrtime.bigint() - previous.started) /
            (nanosecondsPerMicrosecond * microsecondsPerMillisecond)
    });
    socket.write('import\n');
}

function receiveMessage(messages: ModuleMessages, socket: Socket, line: string): void {
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

function observeSocket(messages: ModuleMessages, socket: Socket): void {
    messages.addSocket(socket);
    const fail = function failed(error: unknown): void {
        messages.reply.resolve({ kind: 'failed', error });
    };
    const frames = createJsonFrameLimiter(maximumFrameBytes, 'Module import');
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

async function closeServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
    for (const socket of sockets) {
        socket.destroy();
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

function boundPort(server: Server): number {
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Module import requires a local socket.');
    }
    return address.port;
}

export async function createModuleImportSession(): Promise<ModuleImportSession> {
    const sockets = new Set<Socket>();
    const messages: ModuleMessages = {
        token: randomBytes(tokenBytes).toString('hex'),
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
    const server = createServer(observeSocket.bind(null, messages));
    await new Promise<void>(function listen(resolve, reject) {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        arguments: [ String(boundPort(server)), messages.token ],
        start() {
            messages.progress.write({ ...messages.progress.read(), started: process.hrtime.bigint() });
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
