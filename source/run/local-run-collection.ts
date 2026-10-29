import { createResultFromResolutionError } from './run-collection-error-result.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import {
    createLocalRunOrEmptySelectionResultFromInput,
    type LocalRunCollectionSource as RunCollectionSource
} from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunRecordSession } from './run-record.ts';
import type { RunResultSession, RunRuntimePolicy } from './run-support.ts';
import { emptyTimingSpanMetadata, type RunTimingMeasurement } from './run-timing-collection.ts';
import type { ResolvedRun, RunCommand } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

export type LocalRunOptions = {
    readonly record: RunRecordSession | null;
    readonly baseline: RunResultSession | null;
    readonly input: ResolvedRunInput;
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
};
export function isRunResult(value: ResolvedRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

async function resolveRunWithRuntimePolicy<RunValue>(
    resolveRun: () => Promise<RunValue>,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunValue> {
    return runtimePolicy === null ? await resolveRun() : await runtimePolicy.runLoad(resolveRun);
}

export async function createLocalRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    options: LocalRunOptions
): Promise<ResolvedRun | RunResult> {
    const resolveRun = async function resolveLocalRunInsidePolicy(): Promise<ResolvedRun | RunResult> {
        return await options.timing.measureAsync(
            'collection.resolve',
            emptyTimingSpanMetadata(),
            async function createTimedLocalRunOrEmptySelectionResult() {
                const resolved = await createLocalRunOrEmptySelectionResultFromInput(
                    command,
                    dependencies,
                    options.input,
                    options.source
                );
                await options.record?.recordFacts(resolved.facts);
                return resolved.run;
            }
        );
    };

    try {
        return await resolveRunWithRuntimePolicy(resolveRun, runtimePolicy);
    } catch (error: unknown) {
        try {
            return createResultFromResolutionError(error, runtimePolicy);
        } catch {
            runtimePolicy?.takeRunErrors();
            throw error;
        }
    }
}
