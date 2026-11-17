import { createHttpTranscriptRecorder } from '../transcript/http-transcript.ts';
import { defineSimulatedHttpServer } from '../simulation/simulation.ts';
import {
    defineSimulatedHttpService,
    type SimulatedHttpServerResource
} from '../resources/simulated-http-server-resource.ts';
import { resourceAttachments } from '../attachments/attachment-context.ts';
import { localHttpServer, type LocalHttpServerFixture } from './local-http-server.ts';

const simulation = defineSimulatedHttpServer({
    name: 'service',
    scenarios: { default: { title: 'available' }, offline: { title: 'unavailable' } },
    async handle() {
        return new Response('unit');
    }
});
type SimulatedResource = SimulatedHttpServerResource<typeof simulation>;
type SimulatedResourceFixture = LocalHttpServerFixture & {
    readonly service: SimulatedResource;
    readonly context: Parameters<SimulatedResource['acquire']>[0];
};
export function simulatedHttpResource(errors: readonly unknown[]): SimulatedResourceFixture {
    const server = localHttpServer({ listen: null, close: null, address: 'tcp' });
    const service = defineSimulatedHttpService(
        { simulation, address: { kind: 'loopback', port: 0 } },
        function () {
            return {
                server: server.server,
                errors,
                transcript: createHttpTranscriptRecorder<{ readonly scenario: string; }>().transcript
            };
        }
    );
    return {
        ...server,
        service,
        context: {
            dependencies: {},
            scenarios: { service: 'default' },
            signal: AbortSignal.any([]),
            attachments: resourceAttachments('test'),
            workload: null
        }
    };
}
