import type { ConfigLoadRequest } from '../config/config-loader.ts';
import type {
    DebugRequestInput,
    RunCommand,
    RunRequest,
    RunInvocationOptions,
    RunnerResult,
    RunReporterDeliveryResult
} from './run-types.ts';

export type ReplayWitnessRequest = {
    readonly debug: RunRequest['debug'];
    readonly path: string;
    readonly profile: string | null;
    readonly seed: RunRequest['seed'];
    readonly capture: RunRequest['capture'];
    readonly record: boolean;
    readonly timingCollection: RunRequest['timingCollection'];
};
export type ReplayWitnessCommand = Pick<RunCommand, 'config' | 'cwd' | 'engine'> & {
    readonly request: DebugRequestInput<ReplayWitnessRequest>;
};
export type ReplayWitnessOperations = {
    readonly replayWitness: (command: ReplayWitnessCommand, options: RunInvocationOptions) => Promise<RunnerResult>;
    readonly replayWitnessWithReporterDelivery: (
        command: ReplayWitnessCommand,
        options: RunInvocationOptions
    ) => Promise<RunReporterDeliveryResult>;
};

export type CommandLineWitnessReplayRequest = ConfigLoadRequest & {
    readonly replayRequest: DebugRequestInput<ReplayWitnessRequest>;
};
