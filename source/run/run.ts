import {
    readResolvedRunInput
} from './run-input-resolution.ts';
import {
    createIsolatedResolvedRun,
    runIsolatedProcessCommand
} from './run-isolated-process.ts';
import { runLocalCommand } from './run-local-command.ts';
import { createLocalResolvedRun } from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    configuredFilesRunCollectionSource,
    type CollectionSource,
    type DirectEntrypointCollectionSource
} from './run-collection-source.ts';
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

    return await runLocalCommand(seededCommand, dependencies, timing, source);
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
