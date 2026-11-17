import { serialize } from 'node:v8';
import { receiveCampaignFrames, type CampaignSocket } from '../packages/stryker-runner/campaign-transport.ts';
import { testDouble } from '../packages/test/test.entry-point.ts';
import { memoryCampaignSocket } from './memory-campaign-connection.ts';

export type FrameScenario = 'body-string' | 'header-string' | 'large-header' | 'receiver-failure' | 'zero-header';
type CampaignFrameFixture = {
    readonly socket: CampaignSocket;
    readonly fault: Promise<Error>;
    readonly deliver: () => void;
};
const frameHeaderBytes = 4;
const maximumFrameBytes = 134_217_728;
function declaredFrameBytes(scenario: FrameScenario, body: Buffer): number {
    if (scenario === 'zero-header') {
        return 0;
    }
    if (scenario === 'large-header') {
        return maximumFrameBytes + 1;
    }
    return body.length;
}
function campaignFrameParts(scenario: FrameScenario): ArrayIterator<unknown> {
    const body = serialize('message');
    const header = Buffer.alloc(frameHeaderBytes);
    header.writeUInt32BE(declaredFrameBytes(scenario, body));
    const queue: readonly unknown[] = scenario === 'header-string'
        ? [ 'header' ]
        : [ header, scenario === 'body-string' ? 'body' : body ];
    return queue.values();
}
export function campaignFrameChannel(scenario: FrameScenario): CampaignFrameFixture {
    const fixture = memoryCampaignSocket();
    const parts = campaignFrameParts(scenario);
    const socket = Object.assign(fixture.socket, {
        read() {
            return parts.next().value ?? null;
        }
    });
    const failure = Promise.withResolvers<Error>();
    socket.once('error', failure.resolve);
    receiveCampaignFrames(socket, function () {
        testDouble.throws<() => void>('receiver failed')();
    });
    return {
        socket,
        fault: failure.promise,
        deliver() {
            socket.emit('readable');
        }
    };
}
