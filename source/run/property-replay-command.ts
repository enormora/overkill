import { invalidRequest } from './run-errors.ts';
import { prepareWitnessReplay } from './replay-preparation.ts';
import type { PreparedReplay } from './replay-types.ts';
import type { ReplayWitnessCommand } from './witness-replay-request.ts';

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
        debug: command.request.debug,
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
