import type { NormalizedConfig } from '../config/types.ts';
import type { ReplayExecution } from './replay-context.ts';
import type { ReplayWitnessOperations } from './witness-replay-request.ts';
import type { DebugRequestInput, RunCommand, RunnerResult, RunReporterDeliveryResult } from './run-types.ts';

export type ReplayContext = {
    readonly debug: RunCommand['request']['debug'];
    readonly cwd: string;
    readonly config: NormalizedConfig;
    readonly signal: Readonly<AbortSignal> | null;
};
export type ReplayRunCommand = DebugRequestInput<ReplayContext & { readonly runId: string; }>;
export type ReplayWitnessInput = DebugRequestInput<
    ReplayContext & { readonly path: string; readonly profile: string; }
>;
type DirectReplayOperations = {
    readonly replay: (command: ReplayRunCommand) => Promise<RunnerResult>;
    readonly replayWithReporterDelivery: (command: ReplayRunCommand) => Promise<RunReporterDeliveryResult>;
    readonly replayWitness: (command: ReplayWitnessInput) => Promise<RunnerResult>;
    readonly replayWitnessWithReporterDelivery: (command: ReplayWitnessInput) => Promise<RunReporterDeliveryResult>;
};

export type PreparedReplay = { readonly replay: ReplayExecution; readonly command: RunCommand; };

export type ReplayOperations = DirectReplayOperations & ReplayWitnessOperations;
