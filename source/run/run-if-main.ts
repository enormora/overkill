import type { WallClock } from '@enormora/wall-clock';
import type { ExecuteOptions } from '../engine/execution.ts';
import type { TestNode } from '../engine/test-node.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { defaultRunEngine } from './default-run-engine.ts';
import type { ResourceUsageTrackerOptions } from './resource-usage.ts';
import {
    assertDirectTestPlanMatchesTestFamily,
    directRunFacts,
    runConfig
} from './run-if-main-facts.ts';
import {
    executionMode,
    rootAnnotations,
    rootControls,
    rootTitle,
    selectedOutputRenderer,
    selectedReporters,
    warnOnSupervisedDowngrade,
    type RunIfMainOptions
} from './run-if-main-options.ts';
import type { DirectProfileContext } from './run-if-main-profile.ts';
import { createSeededTestPlan } from './run-selection.ts';

export type RunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
) => Promise<void>;

type RunIfMainExitCode = number | string | null | undefined;
type DirectRuntimePolicy = Exclude<ExecuteOptions['runtimePolicy'], undefined>;
type DirectResourceUsageTracker = Exclude<ExecuteOptions['resourceUsageTracker'], null | undefined>;

export type RunIfMainDependencies = {
    readonly createResourceUsageTracker: (
        wallClock: WallClock,
        options: ResourceUsageTrackerOptions
    ) => DirectResourceUsageTracker;
    readonly createRuntimePolicy: () => DirectRuntimePolicy;
    readonly createWallClock: () => WallClock;
    readonly currentWorkingDirectory: () => string;
    readonly readExitCode: () => RunIfMainExitCode;
    readonly resolveDirectProfile: (meta: Readonly<ImportMeta>, cwd: string) => Promise<DirectProfileContext>;
    readonly runEngine: typeof defaultRunEngine;
    readonly setExitCode: (exitCode: number) => void;
    readonly stderr: {
        readonly write: (chunk: string) => unknown;
    };
};

type DirectRunContext = DirectProfileContext & {
    readonly options: RunIfMainOptions | undefined;
    readonly testNode: TestNode;
};
type DirectRunResult = Awaited<ReturnType<typeof defaultRunEngine.execute>>;

const failureExitCodes = new Set<number | string | null | undefined>([ undefined, null, 0, '0' ]);

function shouldSetFailureExitCode(exitCode: number | string | null | undefined): boolean {
    return failureExitCodes.has(exitCode);
}

async function createDirectRunContext(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options: RunIfMainOptions | undefined,
    dependencies: RunIfMainDependencies
): Promise<DirectRunContext> {
    const context = await dependencies.resolveDirectProfile(meta, dependencies.currentWorkingDirectory());

    return {
        ...context,
        options,
        testNode
    };
}

function directTestPlan(context: DirectRunContext, dependencies: RunIfMainDependencies): TestPlan {
    return dependencies.runEngine.createTestPlan(dependencies.runEngine.createRoot({
        annotations: rootAnnotations(context.options),
        children: [ context.testNode ],
        controls: rootControls(context.options),
        title: rootTitle(context.options, context.projectRoot)
    }));
}

async function executeDirectTestPlan(
    context: DirectRunContext,
    testPlan: TestPlan,
    dependencies: RunIfMainDependencies
): Promise<DirectRunResult> {
    const wallClock = dependencies.createWallClock();
    const reporters = await selectedReporters(context.profile, context.config, context.options);
    const config = runConfig(context.config, reporters);
    const ordered = createSeededTestPlan(testPlan);
    const runFacts = directRunFacts({
        config,
        fileSet: context.fileSet,
        profileName: context.name,
        projectRoot: context.projectRoot,
        seed: ordered.seed,
        testPlan: ordered.testPlan
    });
    const runtimePolicy = dependencies.createRuntimePolicy();
    const { resourceUsagePolicy } = runFacts.execution;
    const startedAt = new Date(wallClock.currentTimestampInMilliseconds);

    warnOnSupervisedDowngrade(context.profile, dependencies.stderr);

    return await dependencies.runEngine.execute(ordered.testPlan, {
        execution: { mode: executionMode(context.profile) },
        outputRenderer: selectedOutputRenderer(context.config, context.options),
        reporters,
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageTracker: resourceUsagePolicy.measure
            ? dependencies.createResourceUsageTracker(wallClock, {
                samplingIntervalMilliseconds: resourceUsagePolicy.samplingIntervalMilliseconds
            })
            : null,
        runtimePolicy,
        runFacts,
        startedAt: startedAt.toISOString(),
        timeoutPolicy: {
            hardTimeoutMilliseconds: runFacts.execution.timeoutPolicy.hardMilliseconds,
            timeoutMilliseconds: runFacts.execution.timeoutPolicy.softMilliseconds
        }
    });
}

function hasFailure(result: DirectRunResult): boolean {
    return result.summary.failed > 0 || result.runnerErrors.length > 0;
}

function applyFailureExitCode(result: DirectRunResult, dependencies: RunIfMainDependencies): void {
    if (hasFailure(result) && shouldSetFailureExitCode(dependencies.readExitCode())) {
        dependencies.setExitCode(1);
    }
}

async function executeDirectRun(context: DirectRunContext, dependencies: RunIfMainDependencies): Promise<void> {
    const testPlan = directTestPlan(context, dependencies);

    assertDirectTestPlanMatchesTestFamily(testPlan, context.profile.testFamily);
    applyFailureExitCode(await executeDirectTestPlan(context, testPlan, dependencies), dependencies);
}

async function runDirectEntrypoint(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options: RunIfMainOptions | undefined,
    dependencies: RunIfMainDependencies
): Promise<void> {
    await executeDirectRun(await createDirectRunContext(meta, testNode, options, dependencies), dependencies);
}

export function createRunIfMain(dependencies: RunIfMainDependencies): RunIfMain {
    return async function runIfMain(meta, testNode, options) {
        if (!meta.main) {
            return;
        }

        await runDirectEntrypoint(meta, testNode, options, dependencies);
    };
}
