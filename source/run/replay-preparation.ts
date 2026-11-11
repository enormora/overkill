import path from 'node:path';
import { parseWitnessFile, type WitnessFile, type PropertyWitnessFile } from '../engine/witness-file.ts';
import { verifyWitnessSource } from './replay-files.ts';
import { invalidRequest } from './run-errors.ts';
import { restoreReplayProfile } from './replay-profile.ts';
import { readRecordedReplay } from './replay-record.ts';
import { readWitnessReplayFile, decodeReplayInput } from './replay-input.ts';
import type { PreparedReplay, ReplayContext, ReplayRunCommand, ReplayWitnessInput } from './replay-types.ts';
import type { RunSelection, WorkId } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type WitnessCommandContext = Readonly<Record<PropertyKey, never>> | { readonly propertyReplay: PropertyWitnessFile; };
function propertyWitnessCommand(witness: WitnessFile | null): WitnessCommandContext {
    return witness?.kind === 'property' ? { propertyReplay: witness } : {};
}
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
    const profile = decodeReplayInput(record.replayProfile, function restore(value) {
        return restoreReplayProfile(value, input.config.profiles[profileName]);
    });
    if (
        profile.testFamily !== record.facts.execution.testFamily ||
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
function witnessSourceRun(input: ReplayWitnessInput): string | null {
    const runs = path.resolve(input.cwd, input.config.runtimeStateDir, 'runs');
    const relative = path.relative(runs, path.resolve(input.cwd, input.path));
    const [ id, ...parts ] = relative.split(path.sep);
    return id !== undefined && /^[A-Za-z0-9_-]+$/u.test(id) && parts.length > 0 ? id : null;
}
export async function prepareWitnessReplay(
    input: ReplayContext & ReplayWitnessInput
): Promise<PreparedReplay> {
    const raw = await readWitnessReplayFile(path.resolve(input.cwd, input.path));
    const witness = decodeReplayInput(raw, parseWitnessFile);
    const { file } = witness.case;
    if (file === null || path.isAbsolute(file) || file.split(/[\\/]/u).includes('..')) {
        invalidRequest('Witness must identify a project-relative source module.');
    }
    await verifyWitnessSource(input.cwd, file);
    return {
        replay: { kind: 'witness', witness, sourceRunId: witnessSourceRun(input), moduleGraph: 'fresh' },
        command: {
            ...propertyWitnessCommand(witness),
            cwd: input.cwd,
            config: input.config,
            engine: { kind: 'default' },
            request: {
                baselineUpdateMode: 'none',
                capabilityRestrictions: { mode: 'enabled' },
                capture: 'buffered',
                coverage: false,
                debug: input.debug,
                execution: { mode: 'profile-default' },
                lastFailed: false,
                measureProcessUsage: null,
                order: 'plan',
                paths: [ file ],
                profile: input.profile,
                processBudgetOverrides: null,
                processUsageSamplingIntervalMilliseconds: null,
                record: true,
                recordForMerge: false,
                seed: { value: BigInt(witness.kind === 'property' ? witness.seed : '0') },
                selection: {
                    kind: 'filter',
                    filter: witness.kind === 'property'
                        ? {
                            kind: 'work-id',
                            id: { familyVariant: null, case: witness.case, runtimes: witness.runtimes, workload: null }
                        }
                        : { kind: 'case-id', id: witness.case }
                },
                shard: { index: 1, total: 1 },
                timingCollection: 'profile-default',
                verbose: false,
                workers: null
            }
        }
    };
}
