import { replayEmptySelection } from './replay-empty-selection.ts';
import type { PreparedBenchmarkRun } from './benchmark-baseline-preparation.ts';
import type { ResolvedRunInput, RunInvocation } from './run-input-resolution.ts';
import { runIsolatedProcessCommand, type IsolatedRunOptions } from './run-isolated-process.ts';
import { runLocalCommand } from './run-local-command.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import type { RunCommand } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

type RunPreparationInput = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly timing: RunTimingMeasurement;
};
async function prepareRun(
    invocation: RunInvocation,
    options: RunPreparationInput
): Promise<PreparedBenchmarkRun | RunResult> {
    if (invocation.namespace === 'test') {
        return { input: options.input, session: null };
    }
    const { prepareBenchmarkExecution } = await import('./benchmark-baseline-run.ts');
    return await prepareBenchmarkExecution(options);
}

type PreparedExecution = {
    readonly record: IsolatedRunOptions['record'];
    readonly source: IsolatedRunOptions['source'];
    readonly timing: RunTimingMeasurement;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly signal: Readonly<AbortSignal> | null;
};

async function executePreparedRun(prepared: PreparedBenchmarkRun, options: PreparedExecution): Promise<RunResult> {
    const { command: resolvedCommand, dependencies, source, timing } = options;
    const { input, session: baseline } = prepared;
    const executionDependencies = baseline === null ? dependencies : {
        ...dependencies,
        reporterDispatcher: baseline.reporterDispatcher
    };
    const emptyReplay = replayEmptySelection({ ...options, input });
    if (emptyReplay !== null) {
        return await emptyReplay;
    }
    const isolatedResult = runIsolatedProcessCommand(resolvedCommand, executionDependencies, {
        baseline,
        record: options.record,
        source,
        timing,
        signal: options.signal
    }, input);

    if (isolatedResult !== null) {
        return await isolatedResult;
    }

    return await runLocalCommand(resolvedCommand, executionDependencies, {
        baseline,
        input,
        source,
        timing,
        record: options.record
    });
}

function isRunResult(value: PreparedBenchmarkRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

export async function executePreparedInvocation(
    invocation: RunInvocation,
    options: PreparedExecution & { readonly input: ResolvedRunInput; }
): Promise<RunResult> {
    const prepared = await prepareRun(invocation, options);
    return isRunResult(prepared) ? prepared : await executePreparedRun(prepared, options);
}
