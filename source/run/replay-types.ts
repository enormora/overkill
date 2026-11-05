import type { NormalizedConfig } from '../config/types.ts';
import type { ReplayExecution } from './replay-context.ts';
import type { ReplayWitnessOperations } from './witness-replay-request.ts';
import type { RunCommand, RunnerResult, RunReporterDeliveryResult } from './run-types.ts';

export type ReplayContext = {
    readonly cwd: string;
    readonly config: NormalizedConfig;
    readonly signal: Readonly<AbortSignal> | null;
};
export type ReplayRunCommand = ReplayContext & { readonly runId: string; };
export type ReplayWitnessInput = ReplayContext & { readonly path: string; readonly profile: string; };
type DirectReplayOperations = {
    readonly replay: (command: ReplayRunCommand) => Promise<RunnerResult>;
    readonly replayWithReporterDelivery: (command: ReplayRunCommand) => Promise<RunReporterDeliveryResult>;
    readonly replayWitness: (command: ReplayWitnessInput) => Promise<RunnerResult>;
    readonly replayWitnessWithReporterDelivery: (command: ReplayWitnessInput) => Promise<RunReporterDeliveryResult>;
};

export type PreparedReplay = { readonly replay: ReplayExecution; readonly command: RunCommand; };

export type ReplayOperations = DirectReplayOperations & ReplayWitnessOperations;
