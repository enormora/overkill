import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import {
    executeInProcessResolvedRun
} from './run-in-process-execution.ts';
import {
    readResolvedRunInput
} from './run-input-resolution.ts';
import {
    createIsolatedResolvedRun,
    executeNonLocalResolvedRun,
    runIsolatedProcessCommand
} from './run-isolated-process.ts';
import {
    createLocalResolvedRun,
    createLocalRunOrEmptySelectionResult
} from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    assertRunnableResourceUsagePolicy,
    createRunRuntimePolicy,
    type RunRuntimePolicy
} from './run-support.ts';
import type {
    ResolvedRun,
    RunCommand,
    RunOrchestrator
} from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

function commandWithResolvedSeed(command: RunCommand, dependencies: RunOrchestratorDependencies): RunCommand {
    if (command.request.seed.value !== null) {
        return command;
    }

    return {
        ...command,
        request: {
            ...command.request,
            seed: { value: dependencies.createSeed() }
        }
    };
}

async function createResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<ResolvedRun> {
    const seededCommand = commandWithResolvedSeed(command, dependencies);
    const input = await readResolvedRunInput(seededCommand, dependencies);
    const isolatedRun = createIsolatedResolvedRun(seededCommand, dependencies, input);

    if (isolatedRun !== null) {
        return await isolatedRun;
    }

    return await createLocalResolvedRun(seededCommand, dependencies, input);
}

function isRunResult(value: ResolvedRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

async function resolveRunWithRuntimePolicy<RunValue>(
    resolveRun: () => Promise<RunValue>,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunValue> {
    return runtimePolicy === null ? await resolveRun() : await runtimePolicy.runLoad(resolveRun);
}

async function createLocalRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<ResolvedRun | RunResult> {
    const resolveRun = async function resolveLocalRunInsidePolicy(): Promise<ResolvedRun | RunResult> {
        return await createLocalRunOrEmptySelectionResult(command, dependencies);
    };

    try {
        return await resolveRunWithRuntimePolicy(resolveRun, runtimePolicy);
    } catch (error: unknown) {
        try {
            return createResultFromResolutionError(error, runtimePolicy);
        } catch {
            runtimePolicy?.takeRunErrors();
            throw error;
        }
    }
}

async function executeResolvedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const { resourceUsagePolicy } = resolvedRun.facts.execution;

    assertRunnableResourceUsagePolicy(resourceUsagePolicy);

    const nonLocalResult = await executeNonLocalResolvedRun(resolvedRun, dependencies, runtimePolicy);

    if (nonLocalResult !== null) {
        return nonLocalResult;
    }

    return await executeInProcessResolvedRun(resolvedRun, dependencies, runtimePolicy);
}

async function runCommand(command: RunCommand, dependencies: RunOrchestratorDependencies): Promise<RunResult> {
    const seededCommand = commandWithResolvedSeed(command, dependencies);
    const isolatedResult = runIsolatedProcessCommand(seededCommand, dependencies);

    if (isolatedResult !== null) {
        return await isolatedResult;
    }

    const runtimePolicy = createRunRuntimePolicy(seededCommand.request, dependencies);
    const resolvedRun = await createLocalRunResult(seededCommand, dependencies, runtimePolicy);

    if (isRunResult(resolvedRun)) {
        return await reportCollectionErrorResult(seededCommand, dependencies, resolvedRun);
    }

    return await executeResolvedRun(resolvedRun, dependencies, runtimePolicy);
}

export function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    return {
        async resolve(command) {
            return await createResolvedRun(command, dependencies);
        },

        async run(command) {
            return await runCommand(command, dependencies);
        },

        async runWithReporterDelivery(command) {
            const delivery = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(
                async function runAndTrackReporterDelivery() {
                    return await runCommand(command, dependencies);
                }
            );

            return {
                deliveredRunnerErrors: delivery.deliveredRunnerErrors,
                result: delivery.result,
                undeliveredRunnerErrors: delivery.undeliveredRunnerErrors
            };
        }
    };
}
