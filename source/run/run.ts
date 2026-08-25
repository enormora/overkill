import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeValue } from '../compare/serialized-value.ts';
import type { RunResourceUsageTracker, RunResult } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import {
    collectedRunCaseFacts
} from './collected-run-plan.ts';
import { discoverRunFiles } from './run-discovery.ts';
import {
    invalidRequest,
    noTestsCollected,
    RunCollectionError,
    unsupportedRequest
} from './run-errors.ts';
import { loadRunTestModules } from './run-test-modules.ts';
import {
    copyResourceBudgets,
    copyRunEngineSelection,
    copyRunConfig,
    copyRunRequest,
    createRunRuntimePolicy,
    runEngineFacts,
    type RunRuntimePolicy
} from './run-support.ts';
import {
    collectSupervisedRun,
    executeSupervisedRun,
    runSupervisedCommand
} from './supervised-run.ts';
import {
    invalidRunProfileNameMessage,
    type CollectedRunPlan,
    type ResolvedRun,
    type RunCommand,
    type RunConfig,
    type RunCaseFacts,
    type RunFacts,
    type RunMicrotestExecution,
    type RunMicrotestProfileConfig,
    type RunOrchestrator,
    type RunOrchestratorDependencies,
    type RunProfileConfig,
    type RunRequest,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunTestFamily,
    type RunTimeoutPolicy
} from './run-types.ts';
import {
    resolveRunEngine,
    validateRunEngineSelection
} from './run-engine-selection.ts';

const minimumSeedValue = 0n;

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentTimestampInMilliseconds);

    return startedAt.toISOString();
}

function validateRunShard(request: RunRequest): void {
    if (request.shard.index !== 0 || request.shard.total !== 1) {
        unsupportedRequest('Sharding is not implemented yet.');
    }
}

function validateRunSeed(request: RunRequest): void {
    if (request.seed.value !== null && request.seed.value < minimumSeedValue) {
        invalidRequest('Run seed must be a nonnegative bigint.');
    }
}

function validatePositiveSafeInteger(value: number | null, label: string): void {
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
        invalidRequest(`${label} must be a positive safe integer.`);
    }
}

function validateResourceBudgets(resourceBudgets: RunResourceBudgets): void {
    validatePositiveSafeInteger(resourceBudgets.activeResourceCount, 'Active resource count budget');
    validatePositiveSafeInteger(resourceBudgets.javaScriptEngineHeapBytes, 'JavaScript engine heap budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetBytes, 'Resident set budget');
    validatePositiveSafeInteger(resourceBudgets.residentSetGrowthBytesPerSecond, 'Resident set growth budget');
}

function validateSamplingInterval(value: number | null): void {
    validatePositiveSafeInteger(value, 'Resource usage sampling interval');
}

function validateTimeoutPolicy(policy: RunTimeoutPolicy): void {
    validatePositiveSafeInteger(policy.collectionMilliseconds, 'Collection timeout');
    validatePositiveSafeInteger(policy.softMilliseconds, 'Soft timeout');
    validatePositiveSafeInteger(policy.hardMilliseconds, 'Hard timeout');

    if (policy.softMilliseconds > policy.hardMilliseconds) {
        invalidRequest('Soft timeout must not exceed hard timeout.');
    }
}

function hasResourceBudgets(resourceBudgets: RunResourceBudgets): boolean {
    return resourceBudgets.activeResourceCount !== null ||
        resourceBudgets.javaScriptEngineHeapBytes !== null ||
        resourceBudgets.residentSetBytes !== null ||
        resourceBudgets.residentSetGrowthBytesPerSecond !== null;
}

function validateRunResourceUsageRequest(request: RunRequest): void {
    if (request.resourceBudgetOverrides !== null) {
        validateResourceBudgets(request.resourceBudgetOverrides);
    }

    validateSamplingInterval(request.resourceUsageSamplingIntervalMilliseconds);

    if (
        request.measureResourceUsage === false &&
        request.resourceBudgetOverrides !== null &&
        hasResourceBudgets(request.resourceBudgetOverrides)
    ) {
        invalidRequest('Resource budget overrides require resource usage measurement.');
    }
}

function assertValidRunProfileName(profileName: string): void {
    const message = invalidRunProfileNameMessage(profileName);

    if (message !== null) {
        invalidRequest(message);
    }
}

function validateRunRequest(request: RunRequest): void {
    assertValidRunProfileName(request.profile);

    if (request.paths.length === 0) {
        noTestsCollected('No explicit run paths were provided.');
    }

    validateRunShard(request);
    validateRunSeed(request);
    validateRunResourceUsageRequest(request);
}

async function validateRunPaths(command: RunCommand): Promise<void> {
    await discoverRunFiles({
        cwd: command.cwd,
        paths: command.request.paths
    });
}

function validateRunCommand(command: RunCommand): void {
    validateRunEngineSelection(command.engine);
}

function validateRunResourceUsagePolicy(policy: RunResourceUsagePolicy): void {
    validateResourceBudgets(policy.budgets);
    validateSamplingInterval(policy.samplingIntervalMilliseconds);

    if (!policy.measure && hasResourceBudgets(policy.budgets)) {
        invalidRequest('Resource budgets require resource usage measurement.');
    }
}

function validateRunMicrotestProfile(profile: RunMicrotestProfileConfig): void {
    validateRunResourceUsagePolicy(profile.resourceUsage);
    validateTimeoutPolicy(profile.timeouts);
}

const runProfileValidators: Readonly<Record<RunTestFamily, (profile: RunProfileConfig) => void>> = {
    microtest: validateRunMicrotestProfile
};

function readProfileTestFamily(profile: RunProfileConfig): unknown {
    return (profile as { readonly testFamily?: unknown; }).testFamily;
}

function isRunTestFamily(value: unknown): value is RunTestFamily {
    return value === 'microtest';
}

function validateRunProfile(profileName: string, profile: RunProfileConfig): void {
    const testFamily = readProfileTestFamily(profile);

    if (!isRunTestFamily(testFamily)) {
        invalidRequest(`Invalid run profile "${profileName}": testFamily must be "microtest".`);
    }

    runProfileValidators[testFamily](profile);
}

function validateRunConfig(config: RunConfig): void {
    for (const [ profileName, profile ] of Object.entries(config.profiles)) {
        assertValidRunProfileName(profileName);
        validateRunProfile(profileName, profile);
    }
}

function resolvedSeed(request: RunRequest, dependencies: RunOrchestratorDependencies): bigint {
    return request.seed.value ?? dependencies.createSeed();
}

function runCaseFacts(
    metadata: RunCaseFacts['metadata'],
    id: RunCaseFacts['id']
): RunCaseFacts {
    return {
        id,
        metadata
    };
}

function disabledResourceBudgets(): RunResourceBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function readBudgetOverride(configValue: number | null, requestValue: number | null): number | null {
    return requestValue ?? configValue;
}

function resolveResourceBudgets(
    configBudgets: RunResourceBudgets,
    requestOverrides: RunResourceBudgets | null
): RunResourceBudgets {
    if (requestOverrides === null) {
        return copyResourceBudgets(configBudgets);
    }

    return {
        activeResourceCount: readBudgetOverride(
            configBudgets.activeResourceCount,
            requestOverrides.activeResourceCount
        ),
        javaScriptEngineHeapBytes: readBudgetOverride(
            configBudgets.javaScriptEngineHeapBytes,
            requestOverrides.javaScriptEngineHeapBytes
        ),
        residentSetBytes: readBudgetOverride(configBudgets.residentSetBytes, requestOverrides.residentSetBytes),
        residentSetGrowthBytesPerSecond: readBudgetOverride(
            configBudgets.residentSetGrowthBytesPerSecond,
            requestOverrides.residentSetGrowthBytesPerSecond
        )
    };
}

function assertResourceBudgetOverridesAllowed(
    measureResourceUsage: boolean,
    requestOverrides: RunResourceBudgets | null
): void {
    if (!measureResourceUsage && requestOverrides !== null && hasResourceBudgets(requestOverrides)) {
        invalidRequest('Resource budget overrides require resource usage measurement.');
    }
}

function selectedProfile(request: RunRequest, config: RunConfig): RunMicrotestProfileConfig {
    const profile = config.profiles[request.profile];

    if (profile === undefined) {
        invalidRequest(`Unknown run profile: ${request.profile}`);
    }

    return profile;
}

function assertSupportedProcessEngine(command: RunCommand, profile: RunMicrotestProfileConfig): void {
    if (profile.execution.processModel === 'supervised-process' && command.engine.kind === 'instance') {
        invalidRequest('Instance engines are not supported with supervised-process execution. Use a module engine.');
    }

    if (profile.execution.processModel === 'supervised-process' && command.engine.kind === 'module') {
        let modulePath: string;

        try {
            modulePath = fileURLToPath(command.engine.moduleUrl);
        } catch {
            invalidRequest('Supervised custom engine moduleUrl must be a file URL under cwd.');
        }

        const relativeModulePath = path.relative(command.cwd, modulePath);

        if (relativeModulePath.startsWith('..') || path.isAbsolute(relativeModulePath)) {
            invalidRequest('Supervised custom engine moduleUrl must be under cwd.');
        }
    }
}

function resolveEngineExecutionMode(execution: RunMicrotestExecution): 'concurrent-in-process' | 'serial-in-process' {
    return execution.scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
}

function resolveResourceUsagePolicy(request: RunRequest, profile: RunMicrotestProfileConfig): RunResourceUsagePolicy {
    const configuredPolicy = profile.resourceUsage;
    const measureResourceUsage = request.measureResourceUsage ?? configuredPolicy.measure;
    const resourceUsageSamplingIntervalMilliseconds = request.resourceUsageSamplingIntervalMilliseconds ??
        configuredPolicy.samplingIntervalMilliseconds;
    const resourceBudgets = measureResourceUsage
        ? resolveResourceBudgets(configuredPolicy.budgets, request.resourceBudgetOverrides)
        : disabledResourceBudgets();

    assertResourceBudgetOverridesAllowed(measureResourceUsage, request.resourceBudgetOverrides);

    return {
        budgets: resourceBudgets,
        measure: measureResourceUsage,
        samplingIntervalMilliseconds: resourceUsageSamplingIntervalMilliseconds
    };
}

function createRunFacts(
    cases: readonly RunCaseFacts[],
    engine: RunCommand['engine'],
    request: RunRequest,
    config: RunConfig,
    dependencies: RunOrchestratorDependencies
): RunFacts {
    const profile = selectedProfile(request, config);

    return {
        cases,
        environment: {
            node: {
                arch: dependencies.node.arch,
                platform: dependencies.node.platform,
                version: dependencies.node.version
            },
            runtimeStateDir: config.runtimeStateDir
        },
        execution: {
            baselineUpdateMode: request.baselineUpdateMode,
            capture: request.capture,
            debug: request.debug,
            engine: runEngineFacts(engine),
            order: request.order,
            processModel: profile.execution.processModel,
            profile: request.profile,
            resourceUsagePolicy: resolveResourceUsagePolicy(request, profile),
            scheduling: profile.execution.scheduling,
            testFamily: profile.testFamily,
            timeoutPolicy: profile.timeouts,
            verbose: request.verbose
        },
        loader: config.loader,
        reproducibility: {
            seed: resolvedSeed(request, dependencies).toString(),
            shard: request.shard
        }
    };
}

function runCaseFactsFromTestPlan(testPlan: TestPlan): readonly RunCaseFacts[] {
    return testPlan.cases.map(function toRunCaseFacts(testCase) {
        return runCaseFacts(serializeValue(testCase.metadata), testCase.id);
    });
}

function freezeValue<Value>(value: Value): Value {
    if (value !== null && typeof value === 'object') {
        for (const propertyValue of Object.values(value)) {
            freezeValue(propertyValue);
        }

        Object.freeze(value);
    }

    return value;
}

async function createTestPlan(command: RunCommand, dependencies: RunOrchestratorDependencies): Promise<TestPlan> {
    const engine = await resolveRunEngine(command.engine, dependencies);
    const files = await discoverRunFiles({ cwd: command.cwd, paths: command.request.paths });
    const testFiles = await loadRunTestModules(files, engine);

    try {
        return engine.createTestPlanFromTestFiles({
            files: testFiles,
            root: {
                metadata: {},
                name: command.cwd
            }
        });
    } catch (error: unknown) {
        throw new RunCollectionError('Failed to collect tests from explicit run inputs.', { cause: error }, 'loader');
    }
}

async function createLocalTestPlan(
    command: RunCommand,
    profile: RunMicrotestProfileConfig,
    dependencies: RunOrchestratorDependencies
): Promise<TestPlan> {
    let timeout: ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null = null;
    const collectionTimeout = new Promise<never>(function rejectOnCollectionTimeout(_resolve, reject) {
        timeout = dependencies.wallClock.setTimeout(function failTimedOutCollection() {
            reject(
                new RunCollectionError(
                    'Collection exceeded collection timeout.',
                    { cause: null },
                    'loader'
                )
            );
        }, profile.timeouts.collectionMilliseconds);
    });

    try {
        return await Promise.race([ createTestPlan(command, dependencies), collectionTimeout ]);
    } finally {
        if (timeout !== null) {
            dependencies.wallClock.clearTimeout(timeout);
        }
    }
}

function supervisedEngine(command: RunCommand): Exclude<RunCommand['engine'], { readonly kind: 'instance'; }> {
    if (command.engine.kind === 'instance') {
        invalidRequest('Instance engines are not supported with supervised-process execution. Use a module engine.');
    }

    return command.engine;
}

function createSupervisedCommandBase(command: RunCommand, profile: RunMicrotestProfileConfig) {
    const resourceUsagePolicy = resolveResourceUsagePolicy(command.request, profile);

    return {
        capabilityRestrictions: command.request.capabilityRestrictions,
        collectionTimeoutMilliseconds: profile.timeouts.collectionMilliseconds,
        cwd: command.cwd,
        engine: supervisedEngine(command),
        hardTimeoutMilliseconds: profile.timeouts.hardMilliseconds,
        paths: command.request.paths,
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resourceUsagePolicy.samplingIntervalMilliseconds,
        scheduling: profile.execution.scheduling,
        timeoutMilliseconds: profile.timeouts.softMilliseconds
    };
}

function createSupervisedCollectCommand(command: RunCommand, profile: RunMicrotestProfileConfig) {
    return {
        ...createSupervisedCommandBase(command, profile),
        kind: 'collect' as const
    };
}

function createSupervisedRunCommand(command: RunCommand, profile: RunMicrotestProfileConfig) {
    return {
        ...createSupervisedCommandBase(command, profile),
        kind: 'run' as const
    };
}

function createResolvedRunFromCollectedPlan(
    command: RunCommand,
    request: RunRequest,
    config: RunConfig,
    profile: RunMicrotestProfileConfig,
    collectedPlan: CollectedRunPlan,
    collectionRunnerErrors: readonly RunResult['runnerErrors'][number][],
    dependencies: RunOrchestratorDependencies
): ResolvedRun {
    const engine = freezeValue(copyRunEngineSelection(command.engine));
    const facts = freezeValue(createRunFacts(
        collectedRunCaseFacts(collectedPlan),
        engine,
        request,
        config,
        dependencies
    ));

    return freezeValue({
        collectionRunnerErrors,
        config,
        cwd: command.cwd,
        engine,
        facts,
        plan: {
            collectedPlan,
            kind: 'supervised' as const
        },
        reporters: profile.reporters ?? config.reporters,
        request
    });
}

async function createResolvedRun(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<ResolvedRun> {
    validateRunCommand(command);
    validateRunRequest(command.request);
    validateRunConfig(command.config);
    await validateRunPaths(command);

    const request = freezeValue(copyRunRequest(command.request));
    const config = freezeValue(copyRunConfig(command.config));
    const profile = selectedProfile(request, config);
    assertSupportedProcessEngine(command, profile);
    const engine = freezeValue(copyRunEngineSelection(command.engine));

    if (profile.execution.processModel === 'supervised-process') {
        const collection = await collectSupervisedRun(createSupervisedCollectCommand(command, profile), dependencies);

        return createResolvedRunFromCollectedPlan(
            command,
            request,
            config,
            profile,
            freezeValue(collection.collectedPlan),
            freezeValue(Array.from(collection.runnerErrors)),
            dependencies
        );
    }

    const testPlan = await createLocalTestPlan(command, profile, dependencies);
    const facts = freezeValue(createRunFacts(
        runCaseFactsFromTestPlan(testPlan),
        engine,
        request,
        config,
        dependencies
    ));

    return freezeValue({
        collectionRunnerErrors: [],
        config,
        cwd: command.cwd,
        engine,
        facts,
        plan: {
            kind: 'local',
            testPlan
        },
        reporters: profile.reporters ?? config.reporters,
        request
    });
}

function assertRunnableResourceUsagePolicy(policy: RunResourceUsagePolicy): void {
    validateRunResourceUsagePolicy(policy);
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

function createCollectionErrorRunResult(
    error: RunCollectionError,
    runtimePolicyErrors: readonly RunResult['runnerErrors'][number][]
): RunResult {
    return {
        artifacts: [],
        bySuite: {},
        orphans: [],
        perTest: [],
        resourceUsage: null,
        runnerErrors: [ ...runtimePolicyErrors, error.runnerError() ],
        summary: {
            crashed: 0,
            defined: 0,
            discovered: 0,
            failed: 0,
            inconclusive: 0,
            passed: 0,
            planned: 0,
            resourceExhausted: 0,
            runtimePolicy: 0,
            skipped: 0
        },
        wallTimeMs: 0
    };
}

function isRunResult(value: ResolvedRun | RunResult): value is RunResult {
    return Object.hasOwn(value, 'summary');
}

function createResultFromResolutionError(
    error: unknown,
    runtimePolicy: RunRuntimePolicy | null
): RunResult {
    if (error instanceof RunCollectionError) {
        return createCollectionErrorRunResult(error, runtimePolicy?.takeRunErrors() ?? []);
    }

    throw error;
}

async function resolveRunWithRuntimePolicy(
    resolveRun: () => Promise<ResolvedRun>,
    runtimePolicy: RunRuntimePolicy | null
): Promise<ResolvedRun> {
    return runtimePolicy === null ? await resolveRun() : await runtimePolicy.runLoad(resolveRun);
}

async function createResolvedRunOrCollectionErrorResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<ResolvedRun | RunResult> {
    const resolveRun = async function resolveRunInsidePolicy(): Promise<ResolvedRun> {
        return await createResolvedRun(command, dependencies);
    };

    try {
        return await resolveRunWithRuntimePolicy(resolveRun, runtimePolicy);
    } catch (error: unknown) {
        return createResultFromResolutionError(error, runtimePolicy);
    }
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

async function createResolvedRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<ResolvedRun | RunResult> {
    try {
        return await createResolvedRunOrCollectionErrorResult(command, dependencies, runtimePolicy);
    } catch (error: unknown) {
        runtimePolicy?.takeRunErrors();
        throw error;
    }
}

async function createSupervisedRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    validateRunCommand(command);
    validateRunRequest(command.request);
    validateRunConfig(command.config);
    await validateRunPaths(command);

    const request = freezeValue(copyRunRequest(command.request));
    const config = freezeValue(copyRunConfig(command.config));
    const profile = selectedProfile(request, config);
    assertSupportedProcessEngine(command, profile);

    if (profile.execution.processModel !== 'supervised-process') {
        throw new Error('Expected supervised-process profile.');
    }

    try {
        const result = await runSupervisedCommand(
            createSupervisedRunCommand(command, profile),
            dependencies,
            function createResolvedRunAfterCollection(collection): ResolvedRun {
                return createResolvedRunFromCollectedPlan(
                    command,
                    request,
                    config,
                    profile,
                    freezeValue(collection.collectedPlan),
                    freezeValue(Array.from(collection.runnerErrors)),
                    dependencies
                );
            }
        );

        return addRunnerErrors(result, runtimePolicy?.takeRunErrors() ?? []);
    } catch (error: unknown) {
        return createResultFromResolutionError(error, runtimePolicy);
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

export function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    return {
        async resolve(command) {
            return await createResolvedRun(command, dependencies);
        },

        async run(command) {
            const runtimePolicy = createRunRuntimePolicy(command.request, dependencies);
            const profile = command.config.profiles[command.request.profile];

            if (profile?.execution.processModel === 'supervised-process') {
                return await createSupervisedRunResult(command, dependencies, runtimePolicy);
            }

            const resolvedRun = await createResolvedRunResult(command, dependencies, runtimePolicy);

            if (isRunResult(resolvedRun)) {
                return resolvedRun;
            }

            return await executeResolvedRun(resolvedRun, dependencies, runtimePolicy);
        }
    };
}
