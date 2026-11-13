import { profileFamilyId } from '../config/types.ts';
import { propertyWitnessCommand } from './witness-replay-preparation.ts';
import { isRecordedFamilyProfile, restoreFamilyReplayProfile } from './replay-family-profile.ts';
import { invalidRequest } from './run-errors.ts';
import { restoreReplayProfile } from './replay-profile.ts';
import { readRecordedReplay } from './replay-record.ts';
import { decodeReplayInput } from './replay-input.ts';
import type { PreparedReplay, ReplayContext, ReplayRunCommand } from './replay-types.ts';
import type { RunSelection, WorkId } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

function recordedSelection(identities: readonly WorkId[]): RunSelection {
    const [ first, ...rest ] = identities;
    if (first === undefined) {
        return { kind: 'none' };
    }
    return {
        kind: 'filter',
        filter: {
            kind: 'any',
            filters: [
                { kind: 'work-id', id: first },
                ...rest.map(function identity(id) {
                    return { kind: 'work-id' as const, id };
                })
            ]
        }
    };
}
export async function prepareRecordedReplay(
    input: ReplayContext & ReplayRunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<PreparedReplay> {
    const record = await readRecordedReplay(input, dependencies);
    const profileName = record.request.profile;
    const profile = isRecordedFamilyProfile(record.replayProfile)
        ? await restoreFamilyReplayProfile(record.replayProfile, input.config.profiles[profileName])
        : decodeReplayInput(record.replayProfile, function restore(value) {
            return restoreReplayProfile(value, input.config.profiles[profileName]);
        });
    if (
        profileFamilyId(profile) !== record.facts.execution.testFamily ||
        profile.execution.processModel !== record.facts.execution.processModel
    ) {
        invalidRequest('Recorded profile and execution facts are inconsistent.');
    }
    return {
        replay: { kind: 'record', record },
        command: {
            ...propertyWitnessCommand(record.replayWitness),
            cwd: input.cwd,
            engine: record.engine,
            config: {
                ...input.config,
                loader: record.loader,
                profiles: { ...input.config.profiles, [profileName]: profile }
            },
            request: {
                ...record.request,
                debug: input.debug,
                baselineUpdateMode: 'none',
                seed: { value: BigInt(record.seed) },
                record: true,
                recordForMerge: false,
                lastFailed: false,
                selection: recordedSelection(record.identities)
            }
        }
    };
}
