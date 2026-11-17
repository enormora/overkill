import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { serialize, deserialize } from 'node:v8';
import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import { type CampaignClient, attachCampaignClient } from '../packages/stryker-runner/campaign-client.ts';
import type { CampaignSocket } from '../packages/stryker-runner/campaign-transport.ts';

import { campaignProtocolVersion, type CampaignResponse } from '../packages/stryker-runner/campaign-protocol.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';

export const memoryCampaignEndpoint = { port: 4321, token: '00000000-0000-4000-8000-000000000000' };
export type MemoryCampaignSocket = {
    readonly socket: Duplex & Pick<CampaignSocket, 'ref' | 'unref'>;
    readonly sent: readonly unknown[];
    readonly nextSent: () => Promise<unknown>;
    readonly ownership: { readonly references: number; readonly releases: number; };
    readonly deliver: (message: unknown) => void;
};
type MemoryCampaignClient = MemoryCampaignSocket & {
    readonly clock: DeterministicClock;
    readonly client: CampaignClient;
    readonly controller: AbortController;
    readonly reply: (id: number, response: CampaignResponse) => void;
};
const frameHeaderBytes = 4;
export function memoryCampaignSocket(): MemoryCampaignSocket {
    const sent: unknown[] = [];
    const delivery = new EventEmitter();
    const ownership = { references: 0, releases: 0 };
    const duplex = new Duplex({
        read() {
            return undefined;
        },
        write(chunk: Buffer, _encoding, callback) {
            const frame: unknown = deserialize(chunk.subarray(frameHeaderBytes));
            sent.push(frame);
            delivery.emit('sent', frame);
            callback();
        }
    });
    const socket = Object.assign(duplex, {
        ref() {
            ownership.references += 1;
        },
        unref() {
            ownership.releases += 1;
        }
    });
    function deliver(message: unknown): void {
        const body = serialize(message);
        const header = Buffer.alloc(frameHeaderBytes);
        header.writeUInt32BE(body.length);
        socket.push(Buffer.concat([ header, body ]));
    }
    return {
        socket,
        sent,
        ownership,
        deliver,
        async nextSent() {
            return await new Promise(function next(resolve) {
                delivery.once('sent', resolve);
            });
        }
    };
}
export async function memoryCampaignClient(scope: TestScope): Promise<MemoryCampaignClient> {
    const fixture = memoryCampaignSocket();
    const controller = new AbortController();
    const connection = attachCampaignClient(memoryCampaignEndpoint, controller.signal, fixture.socket);
    fixture.socket.emit('connect');
    const client = await connection;
    scope.cleanup(client.dispose);
    return {
        ...fixture,
        clock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
        client,
        controller,
        reply(id: number, response: CampaignResponse) {
            fixture.deliver({ version: campaignProtocolVersion, id, response });
        }
    };
}
