import { createWallClock } from '@enormora/wall-clock';
import type { RunResult } from '../engine/run-result.ts';
import type { TestNode } from '../engine/test-node.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createDirectRuntimePolicy } from './direct-runtime-policy.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createNodeResourceUsageTracker } from './resource-usage.ts';
import {
    assertDirectTestPlanMatchesTestFamily,
    directRunFacts,
    runConfig
} from './run-if-main-facts.ts';
import {
    executionMode,
    rootMetadata,
    rootTitle,
    selectedOutputRenderer,
    selectedReporters,
    warnOnSupervisedDowngrade,
    type RunIfMainOptions
} from './run-if-main-options.ts';
import {
    resolveDirectProfile,
    type DirectProfileContext
} from './run-if-main-profile.ts';

export type RunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
) => Promise<void>;

type DirectRunContext = DirectProfileContext & {
    readonly options: RunIfMainOptions | undefined;
    readonly testNode: TestNode;
};

const failureExitCodes = new Set<number | string | null | undefined>([ undefined, null, 0, '0' ]);

function shouldSetFailureExitCode(exitCode: number | string | null | undefined): boolean {
    return failureExitCodes.has(exitCode);
}

async function createDirectRunContext(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options: RunIfMainOptions | undefined
): Promise<DirectRunContext> {
    return {
        ...await resolveDirectProfile(meta, process.cwd()),
        options,
        testNode
    };
}

function directTestPlan(context: DirectRunContext): TestPlan {
    return defaultRunEngine.createTestPlan(defaultRunEngine.createRoot({
        children: [ context.testNode ],
        metadata: rootMetadata(context.profile.testFamily, context.options),
        title: rootTitle(context.options)
    }));
}

async function executeDirectTestPlan(context: DirectRunContext, testPlan: TestPlan): Promise<RunResult> {
    const wallClock = createWallClock();
    const reporters = await selectedReporters(context.profile, context.config, context.options);
    const config = runConfig(context.config, reporters);
    const runFacts = directRunFacts(config, context.name, testPlan);
    const runtimePolicy = createDirectRuntimePolicy();
    const { resourceUsagePolicy } = runFacts.execution;
    const startedAt = new Date(wallClock.currentTimestampInMilliseconds);

    warnOnSupervisedDowngrade(context.profile);

    return await defaultRunEngine.execute(testPlan, {
        execution: { mode: executionMode(context.profile) },
        outputRenderer: selectedOutputRenderer(context.config, context.options),
        reporters,
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageTracker: resourceUsagePolicy.measure
            ? createNodeResourceUsageTracker(wallClock, {
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

function hasFailure(result: RunResult): boolean {
    return result.summary.failed > 0 || result.runnerErrors.length > 0;
}

function applyFailureExitCode(result: RunResult): void {
    if (hasFailure(result) && shouldSetFailureExitCode(process.exitCode)) {
        process.exitCode = 1;
    }
}

async function executeDirectRun(context: DirectRunContext): Promise<void> {
    const testPlan = directTestPlan(context);

    assertDirectTestPlanMatchesTestFamily(testPlan, context.profile.testFamily);
    applyFailureExitCode(await executeDirectTestPlan(context, testPlan));
}

async function runDirectEntrypoint(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options: RunIfMainOptions | undefined
): Promise<void> {
    await executeDirectRun(await createDirectRunContext(meta, testNode, options));
}

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
): Promise<void> {
    if (!meta.main) {
        return;
    }

    await runDirectEntrypoint(meta, testNode, options);
}
