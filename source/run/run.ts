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
    configuredFilesRunCollectionSource,
    type CollectionSource,
    type DirectEntrypointCollectionSource
} from './run-collection-source.ts';
import {
    assertRunnableResourceUsagePolicy,
    createRunRuntimePolicy,
    type RunRuntimePolicy
} from './run-support.ts';
import {
    createRunTimingMeasurement,
    emptyTimingSpanMetadata,
    type RunInvocationTimingOptions,
    type RunTimingMeasurement
} from './run-timing-collection.ts';
import type {
    ResolvedRun,
    RunCommand,
    RunOrchestrator
} from './run-types.ts';

type RunCollectionSource = CollectionSource;
type DirectEntrypointRunCollectionSource = DirectEntrypointCollectionSource;

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type LocalRunOptions = {
    readonly source: RunCollectionSource;
    readonly timing: RunTimingMeasurement | null;
};
export type DirectEntrypointRunner = (
    command: RunCommand,
    source: DirectEntrypointRunCollectionSource,
    options?: RunInvocationTimingOptions
) => ReturnType<RunOrchestrator['runWithReporterDelivery']>;

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
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null,
    source: RunCollectionSource
): Promise<ResolvedRun> {
    const seededCommand = commandWithResolvedSeed(command, dependencies);
    const input = await (timing?.measureAsync(
        'profile.resolve',
        emptyTimingSpanMetadata(),
        async function readTimedResolvedRunInput() {
            return await readResolvedRunInput(seededCommand, dependencies);
        }
    ) ?? readResolvedRunInput(seededCommand, dependencies));
    const isolatedRun = createIsolatedResolvedRun(seededCommand, dependencies, input, { source, timing });

    if (isolatedRun !== null) {
        return await isolatedRun;
    }

    return await (timing?.measureAsync(
        'resolution.freeze',
        emptyTimingSpanMetadata(),
        async function createTimedLocalResolvedRun() {
            return await createLocalResolvedRun(seededCommand, dependencies, input, source);
        }
    ) ?? createLocalResolvedRun(seededCommand, dependencies, input, source));
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
    runtimePolicy: RunRuntimePolicy | null,
    options: LocalRunOptions
): Promise<ResolvedRun | RunResult> {
    const resolveRun = async function resolveLocalRunInsidePolicy(): Promise<ResolvedRun | RunResult> {
        return await (options.timing?.measureAsync(
            'collection.resolve',
            emptyTimingSpanMetadata(),
            async function createTimedLocalRunOrEmptySelectionResult() {
                return await createLocalRunOrEmptySelectionResult(command, dependencies, options.source);
            }
        ) ?? createLocalRunOrEmptySelectionResult(command, dependencies, options.source));
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
    runtimePolicy: RunRuntimePolicy | null,
    timing: RunTimingMeasurement | null
): Promise<RunResult> {
    const { resourceUsagePolicy } = resolvedRun.facts.execution;

    assertRunnableResourceUsagePolicy(resourceUsagePolicy);

    const nonLocalResult = await executeNonLocalResolvedRun(resolvedRun, dependencies, runtimePolicy, timing);

    if (nonLocalResult !== null) {
        return nonLocalResult;
    }

    return await executeInProcessResolvedRun(resolvedRun, dependencies, runtimePolicy, timing);
}

function invocationTiming(
    options: RunInvocationTimingOptions | undefined,
    dependencies: RunOrchestratorDependencies
): RunTimingMeasurement {
    return options?.timing ?? createRunTimingMeasurement(dependencies.wallClock);
}

async function runCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    const seededCommand = commandWithResolvedSeed(command, dependencies);
    const isolatedResult = runIsolatedProcessCommand(seededCommand, dependencies, { source, timing });

    if (isolatedResult !== null) {
        return await isolatedResult;
    }

    const runtimePolicy = createRunRuntimePolicy(seededCommand.request, dependencies);
    const resolvedRun = await createLocalRunResult(
        seededCommand,
        dependencies,
        runtimePolicy,
        { source, timing }
    );

    if (isRunResult(resolvedRun)) {
        return await reportCollectionErrorResult(seededCommand, dependencies, resolvedRun, timing);
    }

    return await executeResolvedRun(resolvedRun, dependencies, runtimePolicy, timing);
}

export function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    return {
        async resolve(command, options) {
            return await createResolvedRun(
                command,
                dependencies,
                invocationTiming(options, dependencies),
                configuredFilesRunCollectionSource
            );
        },

        async run(command, options) {
            return await runCommand(
                command,
                dependencies,
                invocationTiming(options, dependencies),
                configuredFilesRunCollectionSource
            );
        },

        async runWithReporterDelivery(command, options) {
            const timing = invocationTiming(options, dependencies);
            const delivery = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(
                async function runAndTrackReporterDelivery() {
                    return await runCommand(command, dependencies, timing, configuredFilesRunCollectionSource);
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

export function createDirectEntrypointRunner(dependencies: RunOrchestratorDependencies): DirectEntrypointRunner {
    return async function runDirectEntrypoint(command, source, options) {
        const timing = invocationTiming(options, dependencies);
        const delivery = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(
            async function runAndTrackReporterDelivery() {
                return await runCommand(command, dependencies, timing, source);
            }
        );

        return {
            deliveredRunnerErrors: delivery.deliveredRunnerErrors,
            result: delivery.result,
            undeliveredRunnerErrors: delivery.undeliveredRunnerErrors
        };
    };
}
