import { deserialize, serialize } from 'node:v8';
import type { Socket } from 'node:net';

const maximumFrameBytes = 134_217_728;
const headerBytes = 4;

function nextFrameLength(socket: Socket): number | null {
    const header: unknown = socket.read(headerBytes);
    if (header === null) {
        return null;
    }
    if (!Buffer.isBuffer(header)) {
        throw new TypeError('Campaign transport requires binary frames.');
    }
    const length = header.readUInt32BE(0);
    if (length === 0 || length > maximumFrameBytes) {
        throw new Error('Invalid campaign frame size.');
    }
    return length;
}
function readFrameBody(socket: Socket, length: number): Buffer | null {
    const body: unknown = socket.read(length);
    if (body === null) {
        return null;
    }
    if (!Buffer.isBuffer(body)) {
        throw new TypeError('Campaign transport requires binary frames.');
    }
    return body;
}

function receiveNextFrame(
    socket: Socket,
    receive: (message: unknown) => void,
    admission: Readonly<Map<'frame', number>>
): boolean {
    const length = admission.get('frame') ?? nextFrameLength(socket);
    if (length === null) {
        return false;
    }
    admission.set('frame', length);
    const body = readFrameBody(socket, length);
    if (body === null) {
        return false;
    }
    admission.delete('frame');
    receive(deserialize(body));
    return true;
}

function receiveAvailableFrames(
    socket: Socket,
    receive: (message: unknown) => void,
    admission: Readonly<Map<'frame', number>>
): void {
    let receiving = true;
    while (!socket.destroyed && receiving) {
        receiving = receiveNextFrame(socket, receive, admission);
    }
}

export function receiveCampaignFrames(socket: Socket, receive: (message: unknown) => void): void {
    const admission = new Map<'frame', number>();
    socket.on('readable', function receiveReadyFrames() {
        try {
            receiveAvailableFrames(socket, receive, admission);
        } catch (error: unknown) {
            socket.destroy(error instanceof Error ? error : new Error('Invalid campaign frame.', { cause: error }));
        }
    });
}
export async function sendCampaignFrame(socket: Socket, message: unknown): Promise<void> {
    const body = serialize(message);
    if (body.length > maximumFrameBytes) {
        throw new Error('Campaign frame exceeds its size limit.');
    }
    const header = Buffer.alloc(headerBytes);
    header.writeUInt32BE(body.length);
    await new Promise<void>(function (resolve, reject) {
        socket.write(Buffer.concat([ header, body ]), function (error) {
            if (error === null || error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}
