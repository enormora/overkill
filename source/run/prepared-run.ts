import { replayEmptySelection } from './replay-empty-selection.ts';
import type { PreparedRun, RunPreparationInput } from './prepared-run-types.ts';
import type { ResolvedRunInput, RunInvocation } from './run-input-resolution.ts';
import { runIsolatedProcessCommand, type IsolatedRunOptions } from './run-isolated-process.ts';
import { runLocalCommand } from './run-local-command.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

function needsOrdinaryBaselines(input: ResolvedRunInput): boolean {
    const { profile, request } = input;
    if (typeof profile.testFamily !== 'string' || profile.testFamily === 'benchmark') {
        return false;
    }
    return profile.baselines.snapshots || profile.baselines.adapters.length > 0 ||
        request.baselineUpdateMode !== 'none';
}

async function prepareRun(
    invocation: RunInvocation,
    options: RunPreparationInput
): Promise<PreparedRun | RunResult> {
    if ([ 'test', 'baseline' ].includes(invocation.namespace)) {
        const { profile } = options.input;
        if (typeof profile.testFamily !== 'string') {
            return { input: options.input, session: null };
        }
        if (!needsOrdinaryBaselines(options.input)) {
            return { input: options.input, session: null };
        }
        const { prepareOrdinaryBaselineRun } = await import('./baseline-preparation.ts');
        return await prepareOrdinaryBaselineRun(options);
    }
    const { prepareBenchmarkExecution } = await import('./benchmark-baseline-run.ts');
    return await prepareBenchmarkExecution(options);
}

type PreparedExecution = {
    readonly record: IsolatedRunOptions['record'];
    readonly source: IsolatedRunOptions['source'];
    readonly timing: NonNullable<IsolatedRunOptions['timing']>;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly signal: Readonly<AbortSignal> | null;
};

async function executePreparedRun(prepared: PreparedRun, options: PreparedExecution): Promise<RunResult> {
    const { command: resolvedCommand, dependencies, source, timing } = options;
    const { input, session: baseline } = prepared;
    const executionDependencies = baseline === null ? dependencies : {
        ...dependencies,
        reporterDispatcher: baseline.reporterDispatcher,
        execute: dependencies.createExecution(baseline.reporterDispatcher)
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

function isRunResult(value: PreparedRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

export async function executePreparedInvocation(
    invocation: RunInvocation,
    options: PreparedExecution & { readonly input: ResolvedRunInput; }
): Promise<RunResult> {
    const prepared = await prepareRun(invocation, options);
    if (isRunResult(prepared)) {
        return prepared;
    }
    const { profile } = prepared.input;
    if (profile.testFamily !== 'integration' || !profile.baselines.snapshots) {
        return await executePreparedRun(prepared, options);
    }
    const { withSnapshotRun } = await import('./snapshot-preparation.ts');
    return await withSnapshotRun(prepared.input, async function executeSnapshots() {
        return await executePreparedRun(prepared, options);
    });
}
