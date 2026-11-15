import type {
    ConfiguredRunCommand,
    RunCommandInput,
    FrozenRunCommand,
    RunExecutionSessionOptions,
    InitializedRun,
    FreezePolicyInput,
    FrozenMicrotestPolicy,
    BenchmarkOrchestrator,
    RunOperations
} from './run-types.ts';
import type { BaselineOrchestrator } from './baseline-types.ts';
import type { ReplayOperations } from './replay-types.ts';
import type { RunExecutionSession } from './execution-session-types.ts';

type RunCommandOperations = RunOperations<ConfiguredRunCommand | FrozenRunCommand | RunCommandInput>;

export type RunOrchestrator = RunCommandOperations & ReplayOperations & {
    readonly createExecutionSession: (options: RunExecutionSessionOptions) => RunExecutionSession;
    readonly bench: BenchmarkOrchestrator;
    readonly baseline: BaselineOrchestrator;
    readonly freezePolicy: (input: FreezePolicyInput) => Promise<FrozenMicrotestPolicy>;
    readonly initialize: (
        command: ConfiguredRunCommand | FrozenRunCommand | RunCommandInput
    ) => Promise<InitializedRun>;
};
