import {
    collectedRunCaseFacts,
    collectedRunPlanFromTestPlanCases,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import {
    createResultFromResolutionError,
    reportCollectionErrorResult
} from './run-collection-error-result.ts';
import {
    createRunFacts,
    resolveResourceUsagePolicy,
    runCaseFactsFromTestPlan
} from './run-facts.ts';
import { readResolvedRunInput, type ResolvedRunInput } from './run-input-resolution.ts';
import { createLocalTestPlan } from './run-local-test-plan.ts';
import {
    assertCollectedRunPlanHasCases,
    selectedCollectedRunPlan,
    selectedTestPlan,
    selectedTestPlanCases
} from './run-selection.ts';
import {
    assertRunnableResourceUsagePolicy,
    createRunRuntimePolicy,
    freezeValue,
    resolveRunReporters,
    type RunRuntimePolicy
} from './run-support.ts';
import {
    collectSupervisedRun,
    executeSupervisedRun,
    runSupervisedCommand
} from './supervised-run.ts';
import type {
    SupervisedCollectCommand,
    SupervisedRunCommand
} from './supervised-protocol.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunCommand,
    RunConfig,
    RunMicrotestExecution,
    RunMicrotestProfileConfig,
    RunOrchestrator,
    RunOrchestratorDependencies,
    RunRequest,
    RunResourceUsagePolicy
} from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type RunResourceUsageTracker = ReturnType<RunOrchestratorDependencies['createResourceUsageTracker']>;

type SupervisedCommandBase = {
    readonly capabilityRestrictions: SupervisedRunCommand['capabilityRestrictions'];
    readonly collectionTimeoutMilliseconds: number;
    readonly cwd: string;
    readonly engine: SupervisedRunCommand['engine'];
    readonly hardTimeoutMilliseconds: number;
    readonly paths: readonly string[];
    readonly resourceBudgets: SupervisedRunCommand['resourceBudgets'];
    readonly resourceUsageSamplingIntervalMilliseconds: number;
    readonly scheduling: SupervisedRunCommand['scheduling'];
    readonly testFamily: SupervisedRunCommand['testFamily'];
    readonly timeoutMilliseconds: number;
};

type CollectedResolvedRunInput = {
    readonly allowEmptySelection: boolean;
    readonly collectionRunnerErrors: readonly RunResult['runnerErrors'][number][];
    readonly collectedPlan: CollectedRunPlan;
    readonly command: RunCommand;
    readonly config: RunConfig;
    readonly dependencies: RunOrchestratorDependencies;
    readonly engine: RunCommand['engine'];
    readonly profile: RunMicrotestProfileConfig;
    readonly request: RunRequest;
};

type SupervisedCollection = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
};

type SupervisedResolutionFromCollectionInput = {
    readonly allowEmptySelection: boolean;
    readonly collection: SupervisedCollection;
    readonly command: RunCommand;
    readonly dependencies: RunOrchestratorDependencies;
    readonly input: ResolvedRunInput;
};

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentTimestampInMilliseconds);

    return startedAt.toISOString();
}

function resolveEngineExecutionMode(execution: RunMicrotestExecution): 'concurrent-in-process' | 'serial-in-process' {
    return execution.scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
}

function supervisedEngine(command: RunCommand): Exclude<RunCommand['engine'], { readonly kind: 'instance'; }> {
    if (command.engine.kind === 'instance') {
        throw new Error('Instance engines cannot run in supervised children.');
    }

    return command.engine;
}

function createSupervisedCommandBase(
    command: RunCommand,
    profile: RunMicrotestProfileConfig,
    files: ResolvedRunInput['files']
): SupervisedCommandBase {
    const resourceUsagePolicy = resolveResourceUsagePolicy(command.request, profile);

    return {
        capabilityRestrictions: command.request.capabilityRestrictions,
        collectionTimeoutMilliseconds: profile.timeouts.collectionMilliseconds,
        cwd: command.cwd,
        engine: supervisedEngine(command),
        hardTimeoutMilliseconds: profile.timeouts.hardMilliseconds,
        paths: files.map(function toFilePath(file) {
            return file.file;
        }),
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resourceUsagePolicy.samplingIntervalMilliseconds,
        scheduling: profile.execution.scheduling,
        testFamily: profile.testFamily,
        timeoutMilliseconds: profile.timeouts.softMilliseconds
    };
}

function createSupervisedCollectCommand(
    command: RunCommand,
    profile: RunMicrotestProfileConfig,
    files: ResolvedRunInput['files']
): SupervisedCollectCommand {
    return {
        ...createSupervisedCommandBase(command, profile, files),
        kind: 'collect' as const
    };
}

function createSupervisedRunCommand(
    command: RunCommand,
    profile: RunMicrotestProfileConfig,
    files: ResolvedRunInput['files']
): SupervisedRunCommand {
    return {
        ...createSupervisedCommandBase(command, profile, files),
        kind: 'run' as const
    };
}

function createResolvedRunFromCollectedPlan(input: CollectedResolvedRunInput): ResolvedRun {
    if (!input.allowEmptySelection) {
        assertCollectedRunPlanHasCases(input.collectedPlan);
    }

    const facts = freezeValue(createRunFacts({
        cases: collectedRunCaseFacts(input.collectedPlan),
        config: input.config,
        dependencies: input.dependencies,
        engine: input.engine,
        request: input.request
    }));

    return freezeValue({
        collectionRunnerErrors: input.collectionRunnerErrors,
        config: input.config,
        cwd: input.command.cwd,
        engine: input.engine,
        facts,
        plan: {
            collectedPlan: input.collectedPlan,
            kind: 'supervised' as const
        },
        reporters: resolveRunReporters(input.profile, input.config.reporters),
        request: input.request
    });
}

function createResolvedRunFromSupervisedCollection(resolution: SupervisedResolutionFromCollectionInput): ResolvedRun {
    const collectedPlan = selectedCollectedRunPlan(
        resolution.collection.collectedPlan,
        resolution.input.request.selection
    );

    return createResolvedRunFromCollectedPlan({
        allowEmptySelection: resolution.allowEmptySelection,
        collectionRunnerErrors: freezeValue(Array.from(resolution.collection.runnerErrors)),
        collectedPlan: freezeValue(collectedPlan),
        command: resolution.command,
        config: resolution.input.config,
        dependencies: resolution.dependencies,
        engine: resolution.input.engine,
        profile: resolution.input.profile,
        request: resolution.input.request
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

    return createResolvedRunFromSupervisedCollection({
        allowEmptySelection: false,
        collection,
        command,
        dependencies,
        input
    });
}

function createLocalResolvedRunFromTestPlan(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput,
    plannedTestPlan: Awaited<ReturnType<typeof createLocalTestPlan>>
): ResolvedRun {
    const facts = freezeValue(createRunFacts({
        cases: runCaseFactsFromTestPlan(plannedTestPlan),
        config: input.config,
        dependencies,
        engine: input.engine,
        request: input.request
    }));

    return freezeValue({
        collectionRunnerErrors: [],
        config: input.config,
        cwd: command.cwd,
        engine: input.engine,
        facts,
        plan: {
            kind: 'local',
            testPlan: plannedTestPlan
        },
        reporters: resolveRunReporters(input.profile, input.config.reporters),
        request: input.request
    });
}

async function createLocalResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    input: ResolvedRunInput
): Promise<ResolvedRun> {
    return createLocalResolvedRunFromTestPlan(
        command,
        dependencies,
        input,
        selectedTestPlan(
            await createLocalTestPlan(command, input.profile, input.files, dependencies),
            input.request.selection
        )
    );
}

function createEmptySelectionResult(
    testPlan: Awaited<ReturnType<typeof createLocalTestPlan>>,
    dependencies: RunOrchestratorDependencies
): RunResult {
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;

    return freezeValue(createRunResultFromCollectedPlan(
        collectedRunPlanFromTestPlanCases(testPlan, []),
        [],
        [],
        {
            resourceUsage: null,
            startedAtMs,
            wallClock: dependencies.wallClock
        }
    ));
}

async function createLocalRunOrEmptySelectionResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<ResolvedRun | RunResult> {
    const input = await readResolvedRunInput(command);

    if (input.profile.execution.processModel !== 'in-process') {
        throw new Error('Expected in-process profile.');
    }

    const testPlan = await createLocalTestPlan(command, input.profile, input.files, dependencies);
    const selectionResult = selectedTestPlanCases(testPlan, input.request.selection);
    const firstCase = selectionResult.plannedCases[0];

    if (firstCase === undefined) {
        return createEmptySelectionResult(testPlan, dependencies);
    }

    return createLocalResolvedRunFromTestPlan(command, dependencies, input, {
        ...testPlan,
        cases: [ firstCase, ...selectionResult.plannedCases.slice(1) ]
    });
}

async function createResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<ResolvedRun> {
    const input = await readResolvedRunInput(command);

    if (input.profile.execution.processModel === 'supervised-process') {
        return await createSupervisedResolvedRun(command, dependencies, input);
    }

    return await createLocalResolvedRun(command, dependencies, input);
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
    runtimePolicy: RunRuntimePolicy | null,
    input: ResolvedRunInput
): Promise<RunResult> {
    const result = await runSupervisedCommand(
        createSupervisedRunCommand(command, input.profile, input.files),
        dependencies,
        function createResolvedRunAfterCollection(collection): ResolvedRun {
            return createResolvedRunFromSupervisedCollection({
                allowEmptySelection: true,
                collection,
                command,
                dependencies,
                input
            });
        }
    );

    return addRunnerErrors(result, runtimePolicy?.takeRunErrors() ?? []);
}

async function createSupervisedRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const input = await readResolvedRunInput(command);

    if (input.profile.execution.processModel !== 'supervised-process') {
        throw new Error('Expected supervised-process profile.');
    }

    try {
        return await runSupervisedAndAttachPolicyErrors(command, dependencies, runtimePolicy, input);
    } catch (error: unknown) {
        return await reportCollectionErrorResult(
            command,
            dependencies,
            createResultFromResolutionError(error, runtimePolicy)
        );
    }
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

    if (resolvedRun.plan.kind !== 'local') {
        throw new Error('In-process execution requires a local test plan.');
    }

    return await dependencies.execute(resolvedRun.plan.testPlan, {
        execution: { mode: resolveEngineExecutionMode(resolvedRun.facts.execution) },
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
    const runtimePolicy = createRunRuntimePolicy(command.request, dependencies);
    const profile = command.config.profiles[command.request.profile];

    if (profile?.execution.processModel === 'supervised-process') {
        return await createSupervisedRunResult(command, dependencies, runtimePolicy);
    }

    const resolvedRun = await createLocalRunResult(command, dependencies, runtimePolicy);

    if (isRunResult(resolvedRun)) {
        return await reportCollectionErrorResult(command, dependencies, resolvedRun);
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
