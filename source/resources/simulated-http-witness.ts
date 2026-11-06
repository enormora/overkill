import { z } from 'zod/v4';
import type { SimulationWitnessFile } from '../engine/witness-file.ts';
import { packageVersion } from '../package-version.ts';
import { httpTranscriptArtifactEntry, type HttpTranscript } from '../packages/simulation/transcript.entry-point.ts';
import { withFailureArtifacts, type FailureArtifactAttachments } from './failure-artifacts.ts';
import { withWitnessReplay } from './witness-replay.ts';
import type { AnyResourceDefinition, Awaitable } from './resource-definition-shape.ts';

type HttpWitnessResourceMetadata = Pick<
    AnyResourceDefinition,
    'dependencies' | 'dispose' | 'name' | 'requirements' | 'scenarios' | 'scope'
>;
type HttpWitnessResource = HttpWitnessResourceMetadata & {
    readonly acquire: (context: never) => Awaitable<{ readonly transcript: HttpTranscript<unknown>; }>;
};
type HttpFailureCapture = {
    readonly kind: 'attempt';
    readonly handle: { readonly transcript: HttpTranscript<unknown>; };
    readonly attachments: FailureArtifactAttachments;
    readonly scenarios: Readonly<Record<string, string>>;
} | { readonly kind: 'lifetime'; };
const httpReplayPayload = z.strictObject({
    version: z.literal(1),
    scenarios: z.record(z.string(), z.string()),
    interactions: z.array(z.unknown())
});
function unsupportedSimulationState(witness: SimulationWitnessFile): boolean {
    return witness.runtimeSnapshot !== null || witness.faultConfiguration !== null || witness.seed !== null;
}
export function withHttpSimulationWitness<Resource extends HttpWitnessResource>(
    resource: Resource,
    simulation: string
): Resource {
    const capturing = withFailureArtifacts(
        resource,
        async function captureWitness(capture: HttpFailureCapture) {
            if (capture.kind !== 'attempt') {
                return;
            }
            const producer = await packageVersion(import.meta.url);
            if (producer === null) {
                throw new TypeError('Simulation witness producer metadata is unavailable.');
            }
            await capture.attachments.witness({
                producedBy: { library: producer.name, libraryVersion: producer.version },
                simulation: {
                    name: simulation,
                    payload: {
                        version: 1,
                        scenarios: capture.scenarios,
                        interactions: capture.handle.transcript.entries.map(httpTranscriptArtifactEntry)
                    }
                },
                scenario: capture.scenarios[simulation] ?? 'default',
                seed: null,
                runtimeSnapshot: null,
                faultConfiguration: null
            });
        }
    );
    return withWitnessReplay(capturing, function restoreSimulation(context) {
        context.signal.throwIfAborted();
        const { witness } = context;
        if (witness.simulation.name !== simulation || unsupportedSimulationState(witness)) {
            throw new TypeError('HTTP simulation witness contains unsupported replay inputs.');
        }
        const payload = httpReplayPayload.parse(witness.simulation.payload);
        if ((payload.scenarios[simulation] ?? 'default') !== (witness.scenario ?? 'default')) {
            throw new TypeError('HTTP simulation witness scenario metadata is inconsistent.');
        }
    });
}
