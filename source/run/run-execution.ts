import { readResolvedRunInput, type RunInvocation, type ResolvedRunInput } from './run-input-resolution.ts';
import { runIsolatedProcessCommand } from './run-isolated-process.ts';
import { runLocalCommand } from './run-local-command.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { PreparedBenchmarkRun } from './benchmark-baseline-run.ts';
import type { CollectionSource as RunCollectionSource } from './run-collection-source.ts';
import { emptyTimingSpanMetadata, type RunTimingMeasurement } from './run-timing-collection.ts';
import type { RunCommand, RunOrchestrator } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

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
    if (invocation.namespace !== 'bench') {
        return { input: options.input, session: null };
    }
    const { prepareBenchmarkExecution } = await import('./benchmark-baseline-run.ts');
    return await prepareBenchmarkExecution(options);
}

type PreparedExecution = {
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement;
};

async function executePreparedRun(prepared: PreparedBenchmarkRun, options: PreparedExecution): Promise<RunResult> {
    const { command: resolvedCommand, dependencies, source, timing } = options;
    const { input, session: baseline } = prepared;
    const executionDependencies = baseline === null ? dependencies : {
        ...dependencies,
        reporterDispatcher: baseline.reporterDispatcher
    };
    const isolatedResult = runIsolatedProcessCommand(resolvedCommand, executionDependencies, {
        baseline,
        source,
        timing
    }, input);

    if (isolatedResult !== null) {
        return await isolatedResult;
    }

    return await runLocalCommand(resolvedCommand, executionDependencies, { baseline, input, source, timing });
}

function isRunResult(value: PreparedBenchmarkRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

export async function executeRunCommand(
    invocation: RunInvocation,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    const seededCommand = invocation.command;
    const resolvedInput = await timing.measureAsync(
        'profile.resolve',
        emptyTimingSpanMetadata(),
        async function readTimedRunInput() {
            return await readResolvedRunInput({ ...invocation, command: seededCommand }, dependencies);
        }
    );
    const resolvedCommand = {
        ...seededCommand,
        config: resolvedInput.config,
        engine: resolvedInput.engine,
        request: resolvedInput.request
    };
    const prepared = await prepareRun(invocation, {
        command: resolvedCommand,
        input: resolvedInput,
        dependencies,
        timing
    });
    if (isRunResult(prepared)) {
        return prepared;
    }
    return await executePreparedRun(prepared, { command: resolvedCommand, dependencies, source, timing });
}
