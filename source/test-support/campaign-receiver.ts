import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import { serveCampaignWorker } from '../packages/stryker-runner/campaign-receiver.ts';
import { campaignProtocolVersion, type CampaignResponse } from '../packages/stryker-runner/campaign-protocol.ts';
import type { CampaignWorker } from '../packages/stryker-runner/campaign-worker.ts';
import type { TestScope } from '@overkill-dev/test';
import {
    memoryCampaignSocket,
    memoryCampaignEndpoint,
    type MemoryCampaignSocket
} from './memory-campaign-connection.ts';

type CampaignReceiverRequest = { readonly kind: 'fetch' | 'release'; };
type ReceiverWorker = { readonly worker: CampaignWorker; readonly events: readonly string[]; };
type CampaignReceiverChannel = MemoryCampaignSocket & {
    readonly clock: DeterministicClock;
    readonly send: (
        id: number,
        timeoutMilliseconds: number | null,
        request: CampaignReceiverRequest
    ) => void;
    readonly cancel: (id: number, reason: 'cancelled' | 'deadline') => void;
};
export function campaignReceiverChannel(scope: TestScope, worker: CampaignWorker): CampaignReceiverChannel {
    const fixture = memoryCampaignSocket();
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    serveCampaignWorker(fixture.socket, memoryCampaignEndpoint.token, worker, clock);
    scope.cleanup(async function closeReceiverChannel() {
        fixture.socket.destroy();
        await Promise.resolve();
    });
    return {
        ...fixture,
        clock,
        send(id: number, timeoutMilliseconds: number | null, request: CampaignReceiverRequest) {
            fixture.deliver({
                kind: 'request',
                version: campaignProtocolVersion,
                token: memoryCampaignEndpoint.token,
                id,
                timeoutMilliseconds,
                request
            });
        },
        cancel(id: number, reason: 'cancelled' | 'deadline') {
            fixture.deliver({
                kind: 'cancel',
                version: campaignProtocolVersion,
                token: memoryCampaignEndpoint.token,
                cancel: id,
                reason
            });
        }
    };
}
export function receiverWorker(
    response: CampaignResponse
): ReceiverWorker {
    const events: string[] = [];
    const worker: CampaignWorker = {
        async respond(request) {
            events.push(request.kind);
            return response;
        },
        cancel() {
            events.push('cancel');
        },
        async dispose() {
            events.push('dispose');
        }
    };
    return { worker, events };
}
