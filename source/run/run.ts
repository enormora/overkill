import {
    readResolvedRunInput,
    type RunInvocation
} from './run-input-resolution.ts';
import {
    createIsolatedResolvedRun
} from './run-isolated-process.ts';
import { executeRunCommand } from './run-execution.ts';
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
    BenchmarkBaselineCommand,
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
            return await readResolvedRunInput({ ...invocation, command: seededCommand }, dependencies);
        }
    ) ?? readResolvedRunInput({ ...invocation, command: seededCommand }, dependencies));
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
    invocation: RunInvocation,
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

function createRunOperations(
    dependencies: RunOrchestratorDependencies,
    namespace: RunInvocation['namespace']
): RunOperations {
    return {
        async resolve(command, options) {
            return await createResolvedRun(
                { command, namespace },
                dependencies,
                invocationTiming(options, dependencies),
                configuredFilesRunCollectionSource
            );
        },

        async run(command, options) {
            return await runCommand(
                { command, namespace },
                dependencies,
                invocationTiming(options, dependencies),
                configuredFilesRunCollectionSource
            );
        },

        async runWithReporterDelivery(command, options) {
            const timing = invocationTiming(options, dependencies);
            const delivery = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(
                async function runAndTrackReporterDelivery() {
                    return await runCommand(
                        { command, namespace },
                        dependencies,
                        timing,
                        configuredFilesRunCollectionSource
                    );
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

export function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    const benchmark = createRunOperations(dependencies, 'bench');
    function baselineVerb(verb: 'apply' | 'bootstrap' | 'diff' | 'update') {
        return async function executeBaselineVerb(
            command: BenchmarkBaselineCommand,
            options: RunInvocationTimingOptions
        ) {
            const { runBenchmarkBaselineVerb } = await import('./benchmark-baseline-operations.ts');
            return await runBenchmarkBaselineVerb({ command, operations: benchmark, options, verb });
        };
    }

    return {
        ...createRunOperations(dependencies, 'test'),
        bench: {
            baseline: {
                apply: baselineVerb('apply'),
                bootstrap: baselineVerb('bootstrap'),
                diff: baselineVerb('diff'),
                async list(command) {
                    const { listBenchmarkBaselines } = await import('./benchmark-baseline-operations.ts');
                    return await listBenchmarkBaselines(command);
                },
                update: baselineVerb('update')
            },
            list: benchmark.resolve,
            run: benchmark.run,
            runWithReporterDelivery: benchmark.runWithReporterDelivery
        }
    };
}

export function createDirectEntrypointRunner(dependencies: RunOrchestratorDependencies): DirectEntrypointRunner {
    return async function runDirectEntrypoint(command, source, options) {
        const timing = invocationTiming(options, dependencies);
        const delivery = await dependencies.reporterDispatcher.trackRunnerErrorDelivery(
            async function runAndTrackReporterDelivery() {
                return await runCommand({ command, namespace: 'test' }, dependencies, timing, source);
            }
        );

        return {
            deliveredRunnerErrors: delivery.deliveredRunnerErrors,
            result: delivery.result,
            undeliveredRunnerErrors: delivery.undeliveredRunnerErrors
        };
    };
}
