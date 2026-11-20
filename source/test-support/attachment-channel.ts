import { Duplex } from 'node:stream';
import {
    attachAttachmentConnection,
    type AttachmentSocket,
    type AttachmentConnection
} from '../run/attachment-connection.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import type { AttachmentReply, AttachmentEndpoint } from '../run/attachment-protocol.ts';
import type { TestScope } from '@overkill-dev/test';

export type AttachmentChannel = {
    readonly endpoint: AttachmentEndpoint;
    readonly connection: AttachmentConnection;
    readonly socket: AttachmentSocket;
    readonly references: { readonly retained: number; readonly released: number; };
    readonly sent: readonly unknown[];
    readonly connect: () => void;
    readonly reply: (value: AttachmentReply) => void;
    readonly deliver: (line: string) => void;
};
export function attachmentChannel(scope: TestScope): AttachmentChannel {
    const sent: unknown[] = [];
    const references = { retained: 0, released: 0 };
    const socket = Object.assign(
        new Duplex({
            read() {
                return undefined;
            },
            write(chunk: Buffer, _encoding, callback) {
                sent.push(JSON.parse(chunk.toString()));
                callback();
            }
        }),
        {
            ref() {
                references.retained += 1;
            },
            unref() {
                references.released += 1;
            }
        }
    );
    socket.on('finish', function finishChannel() {
        socket.destroy();
    });
    const endpoint = {
        port: 4321,
        token: '00000000-0000-4000-8000-000000000000',
        branch: null,
        limits: defaultAttachmentLimits
    };
    const connection = attachAttachmentConnection(endpoint, socket);
    scope.cleanup(async function releaseChannel() {
        socket.destroy();
        await Promise.resolve();
    });
    return {
        endpoint,
        connection,
        socket,
        references,
        sent,
        connect() {
            socket.emit('connect');
        },
        reply(value: AttachmentReply) {
            socket.push(`${JSON.stringify(value)}\n`);
        },
        deliver(line: string) {
            socket.push(`${line}\n`);
        }
    };
}
