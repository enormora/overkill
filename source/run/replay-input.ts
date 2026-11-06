import { readFile } from 'node:fs/promises';
import { RunResolutionError } from './run-errors.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

async function readReplayContent(file: string, dependencies: RunOrchestratorDependencies): Promise<unknown> {
    const content = await dependencies.runtimeStateStore.read(file);
    if (content === null) {
        throw new TypeError('Replay input does not exist.');
    }
    return JSON.parse(content) as unknown;
}
export async function readReplayFile(file: string, dependencies: RunOrchestratorDependencies): Promise<unknown> {
    try {
        return await readReplayContent(file, dependencies);
    } catch (error: unknown) {
        throw new RunResolutionError(`Cannot read replay input: ${file}`, { cause: error }, 'invalid-request');
    }
}
export function decodeReplayInput<Value>(input: unknown, decode: (value: unknown) => Value): Value {
    try {
        return decode(input);
    } catch (error: unknown) {
        throw new RunResolutionError(
            'Replay input is incompatible or incomplete.',
            { cause: error },
            'unsupported-request'
        );
    }
}

export async function readWitnessReplayFile(file: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch (error: unknown) {
        throw new RunResolutionError(`Cannot read replay input: ${file}`, { cause: error }, 'invalid-request');
    }
}
