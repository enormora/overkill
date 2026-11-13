import path from 'node:path';
import { parseWitnessFile, type WitnessFile, type PropertyWitnessFile } from '../engine/witness-file.ts';
import { requestedDebug } from './run-debug.ts';
import type { ReplayWitnessCommand } from './witness-replay-request.ts';
import { verifyWitnessSource } from './replay-files.ts';
import { invalidRequest } from './run-errors.ts';
import { readWitnessReplayFile, decodeReplayInput } from './replay-input.ts';
import type { PreparedReplay, ReplayContext, ReplayWitnessInput } from './replay-types.ts';

type WitnessCommandContext = Readonly<Record<PropertyKey, never>> | { readonly propertyReplay: PropertyWitnessFile; };
export function propertyWitnessCommand(witness: WitnessFile | null): WitnessCommandContext {
    return witness?.kind === 'property' ? { propertyReplay: witness } : {};
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

function replayProfile(command: ReplayWitnessCommand): string {
    const eligible = Object.keys(command.config.profiles).filter(function propertyProfile(name) {
        return command.config.profiles[name]?.testFamily === 'property';
    });
    const inferred = eligible.length === 1 ? eligible[0] : null;
    const selected = command.request.profile ?? inferred;
    if (typeof selected !== 'string' || command.config.profiles[selected] === undefined) {
        return invalidRequest('Select a configured replay profile with --profile.');
    }
    return selected;
}

export async function preparePropertyReplay(command: ReplayWitnessCommand): Promise<PreparedReplay> {
    const prepared = await prepareWitnessReplay({
        debug: requestedDebug(command.request),
        cwd: command.cwd,
        config: command.config,
        signal: null,
        path: command.request.path,
        profile: replayProfile(command)
    });
    return {
        ...prepared,
        replay: prepared.replay.kind === 'witness' ? { ...prepared.replay, moduleGraph: 'current' } : prepared.replay,
        command: {
            ...prepared.command,
            engine: command.engine,
            request: {
                ...prepared.command.request,
                seed: command.request.seed,
                capture: command.request.capture,
                record: command.request.record,
                timingCollection: command.request.timingCollection
            }
        }
    };
}
