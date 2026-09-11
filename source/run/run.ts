import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import {
    createResolvedRunFromCollection
} from './run-collected-resolution.ts';
import {
    readResolvedRunInput,
    type ResolvedRunInput
} from './run-input-resolution.ts';
import {
    assertRunnableResourceUsagePolicy,
    createRunRuntimePolicy,
    type RunRuntimePolicy
} from './run-support.ts';
import {
    collectSupervisedRun,
    executeSupervisedRun,
    runSupervisedCommand
} from './supervised-run.ts';
import {
    collectWorkerPoolRun,
    executeWorkerPoolRun,
    runWorkerPoolCommand
} from './worker-pool-run.ts';
import {
    createLocalResolvedRun,
    createLocalRunOrEmptySelectionResult
} from './run-local-resolution.ts';
import {
    createSupervisedCollectCommand,
    createSupervisedRunCommand,
    createWorkerPoolCommand
} from './run-isolated-command.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunCommand,
    RunOrchestrator,
    RunResourceUsagePolicy,
    RunScheduling
} from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type RunResourceUsageTracker = ReturnType<RunOrchestratorDependencies['createResourceUsageTracker']>;

type CollectedExecution = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
};

type ExecutionResolutionInput = {
    readonly allowEmptySelection: boolean;
    readonly collection: CollectedExecution;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
    readonly planKind: 'supervised' | 'worker-pool';
};

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentTimestampInMilliseconds);

    return startedAt.toISOString();
}

function resolveEngineExecutionMode(scheduling: RunScheduling): 'concurrent-in-process' | 'serial-in-process' {
    return scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
}

function createResolvedExecutionRun(resolution: ExecutionResolutionInput): ResolvedRun {
    return createResolvedRunFromCollection({
        allowEmptySelection: resolution.allowEmptySelection,
        collection: resolution.collection,
        command: resolution.command,
        config: resolution.input.config,
        dependencies: resolution.dependencies,
        engine: resolution.input.engine,
        files: resolution.input.files,
        planKind: resolution.planKind,
        profile: resolution.input.profile,
        projectRoot: resolution.input.projectRoot,
        request: resolution.input.request
    });
}

async function createWorkerPoolResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> {
    const collection = await collectWorkerPoolRun(
        createWorkerPoolCommand(command, input.profile, input.files),
        dependencies
    );
    return createResolvedExecutionRun({
        allowEmptySelection: false,
        collection,
        command,
        dependencies,
        input,
        planKind: 'worker-pool'
    });
}

async function createSupervisedResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> {
    const collection = await collectSupervisedRun(
        createSupervisedCollectCommand(command, input.profile, input.files),
        dependencies
    );

    return createResolvedExecutionRun({
        allowEmptySelection: false,
        collection,
        command,
        dependencies,
        input,
        planKind: 'supervised'
    });
}

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

    if (input.profile.execution.processModel === 'supervised-process') {
        return await createSupervisedResolvedRun(seededCommand, dependencies, input);
    }

    if (input.profile.execution.processModel === 'worker-pool') {
        return await createWorkerPoolResolvedRun(seededCommand, dependencies, input);
    }

    return await createLocalResolvedRun(seededCommand, dependencies, input);
}

function createExecutionResourceUsageTracker(
    policy: RunResourceUsagePolicy,
    dependencies: RunOrchestratorDependencies
): RunResourceUsageTracker | null {
    if (!policy.measure) {
        return null;
    }

    return dependencies.createResourceUsageTracker({
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    });
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

function addRunnerErrors(result: RunResult, runnerErrors: readonly RunResult['runnerErrors'][number][]): RunResult {
    if (runnerErrors.length === 0) {
        return result;
    }

    return {
        ...result,
        runnerErrors: [ ...runnerErrors, ...result.runnerErrors ]
    };
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

async function runSupervisedAndAttachPolicyErrors(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<RunResult> {
    const result = await runSupervisedCommand(
        createSupervisedRunCommand(command, input.profile, input.files),
        dependencies,
        function createResolvedRunAfterCollection(collection): ResolvedRun {
            return createResolvedExecutionRun({
                allowEmptySelection: true,
                collection,
                command,
                dependencies,
                input,
                planKind: 'supervised'
            });
        }
    );

    return result;
}

async function createSupervisedRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    const input = await readResolvedRunInput(command, dependencies);

    if (input.profile.execution.processModel !== 'supervised-process') {
        throw new Error('Expected supervised-process profile.');
    }

    try {
        return await runSupervisedAndAttachPolicyErrors(command, dependencies, input);
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, null)
        );
    }
}

async function createWorkerPoolRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    const input = await readResolvedRunInput(command, dependencies);

    if (input.profile.execution.processModel !== 'worker-pool') {
        throw new Error('Expected worker-pool profile.');
    }

    try {
        return await runWorkerPoolCommand(
            createWorkerPoolCommand(command, input.profile, input.files),
            dependencies,
            function createResolvedRunAfterCollection(collection): ResolvedRun {
                return createResolvedExecutionRun({
                    allowEmptySelection: true,
                    collection,
                    command,
                    dependencies,
                    input,
                    planKind: 'worker-pool'
                });
            }
        );
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, null)
        );
    }
}

function runIsolatedProcessCommand(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> | null {
    const processModel = command.config.profiles[command.request.profile]?.execution.processModel;

    if (processModel === 'supervised-process') {
        return createSupervisedRunResult(command, dependencies);
    }

    if (processModel === 'worker-pool') {
        return createWorkerPoolRunResult(command, dependencies);
    }

    return null;
}

async function executeResolvedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const { resourceUsagePolicy } = resolvedRun.facts.execution;

    assertRunnableResourceUsagePolicy(resourceUsagePolicy);

    if (resolvedRun.facts.execution.processModel === 'supervised-process') {
        const result = await executeSupervisedRun(resolvedRun, dependencies);

        return addRunnerErrors(result, runtimePolicy?.takeRunErrors() ?? []);
    }

    if (resolvedRun.facts.execution.processModel === 'worker-pool') {
        return await executeWorkerPoolRun(resolvedRun, dependencies);
    }

    if (resolvedRun.plan.kind !== 'local') {
        throw new Error('In-process execution requires a local test plan.');
    }

    return await dependencies.execute(resolvedRun.plan.testPlan, {
        execution: { mode: resolveEngineExecutionMode(resolvedRun.facts.execution.scheduling) },
        outputRenderer: resolvedRun.config.outputRenderer,
        reporters: resolvedRun.reporters,
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageTracker: createExecutionResourceUsageTracker(resourceUsagePolicy, dependencies),
        runtimePolicy,
        runFacts: resolvedRun.facts,
        startedAt: currentRunStartTime(dependencies),
        timeoutPolicy: {
            hardTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
            timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
        }
    });
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
                result: delivery.result
            };
        }
    };
}
