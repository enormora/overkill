import { normalizeConfig } from '../config/config.ts';
import type { WitnessFile } from '../engine/witness-file.ts';
import type { WitnessReplayAccess } from '../run/witness-replay-preparation.ts';
import type { ReplayWitnessInput, ReplayContext } from '../run/replay-types.ts';
import type { ReplayWitnessCommand } from '../run/witness-replay-request.ts';
import { propertyCorpusEntry } from './property-corpus.ts';

export const replayPropertyWitness: WitnessFile = propertyCorpusEntry;
export const replaySimulationWitness: WitnessFile = {
    version: 1,
    kind: 'simulation',
    producedBy: propertyCorpusEntry.producedBy,
    case: propertyCorpusEntry.case,
    seed: null,
    simulation: { name: 'simulation', payload: {} },
    resource: null,
    scenario: null,
    runtimeSnapshot: {},
    faultConfiguration: {}
};
export function witnessReplayInput(): ReplayContext & ReplayWitnessInput {
    const config = normalizeConfig({
        profiles: {
            integration: {
                testFamily: 'integration',
                property: {},
                files: { include: [ 'laws.ts' ] },
                execution: { processModel: 'supervised-process' }
            }
        }
    });
    const profile = config.profiles.integration;
    if (profile === undefined) {
        throw new Error('Missing integration profile.');
    }
    return {
        cwd: '/project',
        config: { ...config, profiles: { integration: profile } },
        signal: null,
        debug: { mode: 'off', selectors: [] },
        path: 'witness.json',
        profile: 'integration'
    };
}
export function propertyReplayCommand(profile: string | null): ReplayWitnessCommand {
    const input = witnessReplayInput();
    return {
        cwd: input.cwd,
        config: input.config,
        engine: { kind: 'default' },
        request: {
            path: input.path,
            profile,
            seed: { value: 7n },
            capture: 'live',
            record: false,
            timingCollection: 'precise',
            debug: { mode: 'all', selectors: [] }
        }
    };
}
type WitnessReplayAccessFixture = { readonly access: WitnessReplayAccess; readonly calls: readonly string[]; };
export function witnessReplayAccess(witness: unknown, failure: Error | null): WitnessReplayAccessFixture {
    const calls: string[] = [];
    return {
        calls,
        access: {
            async read(path) {
                calls.push(`read:${path}`);
                return witness;
            },
            async verify(cwd, file) {
                calls.push(`verify:${cwd}:${file}`);
                if (failure !== null) {
                    throw failure;
                }
            }
        }
    };
}
