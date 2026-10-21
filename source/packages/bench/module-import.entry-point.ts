import { once } from 'node:events';
import { connect, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { WriteStream } from 'node:tty';

export const moduleImportEntryPointUrl = new URL(import.meta.url);
const maximumCommandBytes = 32;
const argumentOffset = 2;
const nanosecondsPerMicrosecond = 1000;

async function receiveImportCommand(socket: Socket): Promise<void> {
    let command = '';
    const chunks = socket.iterator({ destroyOnReturn: false });
    for await (const chunk of chunks) {
        command += String(chunk);
        if (command === 'import\n') {
            return;
        }
        if (command.length > maximumCommandBytes) {
            throw new Error('Invalid module import command.');
        }
    }
    throw new Error('Module import owner disconnected before its command.');
}

type ImportResult = { readonly durationMicroseconds: number; readonly failure: string | null; };

async function measuredImport(url: string): Promise<ImportResult> {
    const started = process.hrtime.bigint();
    let failure: string | null = null;
    try {
        await import(url);
    } catch (error: unknown) {
        failure = error instanceof Error ? error.message : String(error);
    }
    return { durationMicroseconds: Number(process.hrtime.bigint() - started) / nanosecondsPerMicrosecond, failure };
}

async function flushOutput(stream: WriteStream): Promise<void> {
    await new Promise<void>(function flushed(resolve, reject) {
        stream.write('', function written(error) {
            if (error !== null && error !== undefined) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function importRequestedModule(port: number, token: string, url: string): Promise<void> {
    const socket = connect({ host: '127.0.0.1', port });
    await once(socket, 'connect');
    socket.write(`${JSON.stringify({ kind: 'ready', token })}\n`);
    await receiveImportCommand(socket);
    const measured = await measuredImport(url);
    const report = {
        kind: 'imported',
        token,
        url,
        ...measured,
        nodeVersion: process.versions.node,
        nodeArguments: process.execArgv
    };
    await Promise.all([ flushOutput(process.stdout), flushOutput(process.stderr) ]);
    await new Promise<void>(function reported(resolve) {
        socket.end(`${JSON.stringify(report)}\n`, resolve);
    });
    // eslint-disable-next-line node/no-process-exit, unicorn/no-process-exit -- Imported modules may leave handles open; this isolated child exits after reporting.
    process.exit(measured.failure === null ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(moduleImportEntryPointUrl)) {
    const [ port, token, url ] = process.argv.slice(argumentOffset);
    if (port === undefined || token === undefined || url === undefined) {
        throw new TypeError('Module import requires a port, token, and file URL.');
    }
    await importRequestedModule(Number(port), token, url);
}
