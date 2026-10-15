import type {
    RunCommand,
    FrozenRunCommand,
    RunExecutionSessionOptions,
    InitializedRun,
    FreezePolicyInput,
    FrozenMicrotestPolicy,
    BenchmarkOrchestrator,
    RunOperations
} from './run-types.ts';
import type { RunExecutionSession } from './execution-session-types.ts';

export type RunOrchestrator = RunOperations<FrozenRunCommand | RunCommand> & {
    readonly createExecutionSession: (options: RunExecutionSessionOptions) => RunExecutionSession;
    readonly bench: BenchmarkOrchestrator;
    readonly freezePolicy: (input: FreezePolicyInput) => Promise<FrozenMicrotestPolicy>;
    readonly initialize: (command: FrozenRunCommand | RunCommand) => Promise<InitializedRun>;
};
