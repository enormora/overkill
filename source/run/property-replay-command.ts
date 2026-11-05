import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseWitnessFile, type WitnessFile } from '../engine/witness-file.ts';
import { invalidRequest } from './run-errors.ts';
import type { RunCommand } from './run-types.ts';
import type { ReplayWitnessCommand, ReplayWitnessOperations } from './witness-replay-request.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { createRunOperations } from './run-operations.ts';

async function readReplayWitness(command: ReplayWitnessCommand): Promise<WitnessFile> {
    try {
        return parseWitnessFile(JSON.parse(await readFile(path.resolve(command.cwd, command.request.path), 'utf8')));
    } catch (error: unknown) {
        return invalidRequest(`Cannot read property witness: ${String(error)}`);
    }
}

function replayProfile(command: ReplayWitnessCommand): string {
    const eligible = Object.keys(command.config.profiles).filter(function propertyProfile(name) {
        return command.config.profiles[name]?.testFamily === 'property';
    });
    const inferred = eligible.length === 1 ? eligible[0] : null;
    const selected = command.request.profile ?? inferred;
    if (typeof selected !== 'string' || !eligible.includes(selected)) {
        return invalidRequest('Select a configured property profile with --profile.');
    }
    return selected;
}

export async function preparePropertyReplay(command: ReplayWitnessCommand): Promise<RunCommand> {
    const profile = replayProfile(command);
    const witness = await readReplayWitness(command);
    if (witness.kind !== 'property') {
        return invalidRequest('Simulation witness replay is not supported.');
    }
    return {
        ...command,
        propertyReplay: witness,
        request: {
            profile,
            seed: command.request.seed,
            capture: command.request.capture,
            record: command.request.record,
            timingCollection: command.request.timingCollection,
            baselineUpdateMode: 'none',
            capabilityRestrictions: { mode: 'enabled' },
            coverage: false,
            lastFailed: false,
            debug: { mode: 'off', selectors: [] },
            execution: { mode: 'profile-default' },
            measureProcessUsage: null,
            order: 'lexical',
            paths: [],
            processBudgetOverrides: null,
            processUsageSamplingIntervalMilliseconds: null,
            selection: {
                kind: 'filter',
                filter: {
                    kind: 'work-id',
                    id: {
                        case: witness.case,
                        runtimes: witness.runtimes,
                        workload: null
                    }
                }
            },
            shard: { index: 1, total: 1 },
            verbose: false,
            workers: null
        }
    };
}

export function createPropertyReplayOperations(dependencies: RunOrchestratorDependencies): ReplayWitnessOperations {
    const operations = createRunOperations(dependencies, 'test');
    return {
        async replayWitness(command, options) {
            return await operations.run(await preparePropertyReplay(command), options);
        },
        async replayWitnessWithReporterDelivery(command, options) {
            return await operations.runWithReporterDelivery(await preparePropertyReplay(command), options);
        }
    };
}
