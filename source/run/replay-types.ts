import type { NormalizedConfig } from '../config/types.ts';
import type { ReplayExecution } from './replay-context.ts';
import type { RunCommand, RunnerResult, RunReporterDeliveryResult } from './run-types.ts';

export type ReplayContext = {
    readonly cwd: string;
    readonly config: NormalizedConfig;
    readonly signal: Readonly<AbortSignal> | null;
};
export type ReplayRunCommand = ReplayContext & { readonly runId: string; };
export type ReplayWitnessCommand = ReplayContext & { readonly path: string; readonly profile: string; };
export type ReplayOperations = {
    readonly replay: (command: ReplayRunCommand) => Promise<RunnerResult>;
    readonly replayWithReporterDelivery: (command: ReplayRunCommand) => Promise<RunReporterDeliveryResult>;
    readonly replayWitness: (command: ReplayWitnessCommand) => Promise<RunnerResult>;
    readonly replayWitnessWithReporterDelivery: (command: ReplayWitnessCommand) => Promise<RunReporterDeliveryResult>;
};

export type PreparedReplay = { readonly replay: ReplayExecution; readonly command: RunCommand; };
