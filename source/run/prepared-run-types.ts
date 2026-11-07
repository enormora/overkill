import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunResultSession } from './run-support.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import type { RunCommand } from './run-types.ts';

export type PreparedRun = { readonly input: ResolvedRunInput; readonly session: RunResultSession | null; };
export type RunPreparationInput = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly timing: RunTimingMeasurement;
};
export type RunPreparationResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>> | PreparedRun;
