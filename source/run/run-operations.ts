import {
    readResolvedRunInput,
    type RunInvocation
} from './run-input-resolution.ts';
import {
    createIsolatedResolvedRun
} from './run-isolated-process.ts';
import { executeRunCommand, type RunExecutionInvocation } from './run-execution.ts';
import { prepareRunCommand, withRunCommandModuleBoundary } from './frozen-run-command.ts';
import { readRunCancellation } from './run-cancellation.ts';
import { createLocalResolvedRun } from './run-local-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type {
    CollectionSource,
    DirectEntrypointCollectionSource
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
    invocation: RunInvocation,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null,
    source: RunCollectionSource
): Promise<ResolvedRun> {
    const seededCommand = commandWithResolvedSeed(invocation.command, dependencies);
    const input = await (timing?.measureAsync(
        'profile.resolve',
        emptyTimingSpanMetadata(),
        async function readTimedResolvedRunInput() {
            return await readResolvedRunInput({ ...invocation, command: seededCommand }, dependencies, source);
        }
    ) ?? readResolvedRunInput({ ...invocation, command: seededCommand }, dependencies, source));
    const resolvedCommand = { ...seededCommand, config: input.config, engine: input.engine, request: input.request };
    const isolatedRun = createIsolatedResolvedRun(resolvedCommand, dependencies, input, {
        baseline: null,
        source,
        timing
    });

    if (isolatedRun !== null) {
        return await isolatedRun;
    }

    return await (timing?.measureAsync(
        'resolution.freeze',
        emptyTimingSpanMetadata(),
        async function createTimedLocalResolvedRun() {
            return await createLocalResolvedRun(resolvedCommand, dependencies, input, source);
        }
    ) ?? createLocalResolvedRun(resolvedCommand, dependencies, input, source));
}

function invocationTiming(
    options: RunInvocationTimingOptions | undefined,
    dependencies: RunOrchestratorDependencies
): RunTimingMeasurement {
    return options?.timing ?? createRunTimingMeasurement(dependencies.wallClock);
}

async function runCommand(
    invocation: RunExecutionInvocation,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    return await executeRunCommand(
        {
            ...invocation,
            command: commandWithResolvedSeed(invocation.command, dependencies)
        },
        dependencies,
        timing,
        source
    );
}

type RunOperations = Pick<RunOrchestrator, 'resolve' | 'run' | 'runWithReporterDelivery'>;

export function createRunOperations(
    dependencies: RunOrchestratorDependencies,
    namespace: RunInvocation['namespace']
): RunOperations {
    return {
        async resolve(command, options) {
            return await withRunCommandModuleBoundary(command, async function collectBoundedRun() {
                const prepared = await prepareRunCommand(command, namespace, dependencies);
                return await createResolvedRun(
                    { command: prepared.command, namespace },
                    dependencies,
                    invocationTiming(options, dependencies),
                    prepared.source
                );
            });
        },

        async run(command, options) {
            const signal = readRunCancellation(command, namespace, options);
            return await withRunCommandModuleBoundary(command, async function executeBoundedRun() {
                const prepared = await prepareRunCommand(command, namespace, dependencies);
                return await runCommand(
                    { command: prepared.command, namespace, signal },
                    dependencies,
                    invocationTiming(options, dependencies),
                    prepared.source
                );
            });
        },

        async runWithReporterDelivery(command, options) {
            const signal = readRunCancellation(command, namespace, options);
            return await withRunCommandModuleBoundary(command, async function deliverBoundedRun() {
                const prepared = await prepareRunCommand(command, namespace, dependencies);
                const timing = invocationTiming(options, dependencies);
                const delivery = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(
                    async function runAndTrackReporterDelivery() {
                        return await runCommand(
                            { command: prepared.command, namespace, signal },
                            dependencies,
                            timing,
                            prepared.source
                        );
                    }
                );

                return {
                    deliveredRunnerErrors: delivery.deliveredRunnerErrors,
                    result: delivery.result,
                    undeliveredRunnerErrors: delivery.undeliveredRunnerErrors
                };
            });
        }
    };
}

export function createDirectEntrypointRunner(dependencies: RunOrchestratorDependencies): DirectEntrypointRunner {
    return async function runDirectEntrypoint(command, source, options) {
        const timing = invocationTiming(options, dependencies);
        const delivery = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(
            async function runAndTrackReporterDelivery() {
                return await runCommand({ command, namespace: 'test', signal: null }, dependencies, timing, source);
            }
        );

        return {
            deliveredRunnerErrors: delivery.deliveredRunnerErrors,
            result: delivery.result,
            undeliveredRunnerErrors: delivery.undeliveredRunnerErrors
        };
    };
}
