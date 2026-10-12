import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from '../engine/execution-global-error-observer.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type { RunnerError, TestPlan } from './run-engine-primitives.ts';
import { RunCollectionError } from './run-errors.ts';
import { createRunTestPlan, createRunTestPlanFromFiles, type RunTestPlanInput } from './run-test-plan.ts';
import { validateFrozenPolicySource } from './frozen-policy-validation.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import { assertTestPlanMatchesTestFamily } from './run-selection.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';
import { frozenSupervisedPolicy, type SupervisedChildCommand } from './supervised-protocol.ts';

export type SupervisedChildTestPlanDependencies = {
    readonly discoverRunFiles: RunTestPlanInput['discoverRunFiles'];
    readonly loadRunEngineModule: RunEngineModuleLoader;
    readonly loadRunTestModules: RunTestPlanInput['loadRunTestModules'];
};

type SelectedSupervisedEngine = Awaited<ReturnType<SupervisedChildTestPlanDependencies['loadRunEngineModule']>>;
const missingObservedChildError: RunnerError = {
    attributedToAttempt: null,
    attributedTo: null,
    attributedToWork: null,
    cause: null,
    diagnostics: [],
    message: 'Supervised child failed after a process-level runtime error.',
    subtype: 'crash'
};

async function selectedEngine(
    command: SupervisedChildCommand,
    dependencies: SupervisedChildTestPlanDependencies
): Promise<SelectedSupervisedEngine> {
    return command.engine.kind === 'module' ? await dependencies.loadRunEngineModule(command.engine) : defaultRunEngine;
}

function firstObservedChildError(observer: ExecutionGlobalErrorObserver): RunCollectionError {
    const [ error ] = [ ...observer.takeErrors(), missingObservedChildError ];

    return new RunCollectionError(
        error.message,
        { cause: error },
        error.subtype
    );
}

async function waitForObservedChildError(observer: ExecutionGlobalErrorObserver): Promise<never> {
    await observer.fatalSignal();
    throw firstObservedChildError(observer);
}

export function runnerErrorFromSupervisedChildFailure(error: unknown): RunnerError {
    if (error instanceof RunCollectionError) {
        return error.runnerError();
    }

    return {
        attributedToAttempt: null,
        attributedTo: null,
        attributedToWork: null,
        cause: error,
        diagnostics: [],
        message: error instanceof Error ? error.message : String(error),
        subtype: 'loader'
    };
}

export async function runObservedSupervisedChildCommand(
    command: SupervisedChildCommand,
    run: () => Promise<void>
): Promise<void> {
    const globalErrorObserver = createExecutionGlobalErrorObserver('supervised-child');
    const boundary = frozenSupervisedPolicy(command)?.moduleBoundary ?? null;

    try {
        await withFileModuleBoundary(boundary, async function completeBoundedCommand() {
            await globalErrorObserver.runBoundary(async function runObservedCommand() {
                await globalErrorObserver.runPhase('collection', async function completeObservedCommand() {
                    await Promise.race([
                        run(),
                        waitForObservedChildError(globalErrorObserver)
                    ]);
                });
            });
        });
    } finally {
        globalErrorObserver.stop();
    }
}

export async function createSupervisedChildTestPlan(
    command: SupervisedChildCommand,
    dependencies: SupervisedChildTestPlanDependencies
): Promise<TestPlan> {
    const engine = await selectedEngine(command, dependencies);
    const input = {
        cwd: command.cwd,
        definitionLocationCapture: command.definitionLocationCapture,
        discoverRunFiles: dependencies.discoverRunFiles,
        engine,
        loadRunTestModules: dependencies.loadRunTestModules,
        paths: command.paths,
        root: command.root,
        testFamily: command.testFamily
    };
    const policy = frozenSupervisedPolicy(command);
    const testPlan = policy === null
        ? await createRunTestPlan(input)
        : await createRunTestPlanFromFiles({ ...input, files: policy.files });

    assertTestPlanMatchesTestFamily(testPlan, command.testFamily);

    return testPlan;
}

export async function validateSupervisedPolicy(
    command: SupervisedChildCommand,
    dependencies: SupervisedChildTestPlanDependencies
): Promise<void> {
    const policy = frozenSupervisedPolicy(command);
    if (policy !== null) {
        await validateFrozenPolicySource(policy, {
            async discoverRunFilesWithProjectRoot(request) {
                return { files: await dependencies.discoverRunFiles(request), projectRoot: policy.projectRoot };
            }
        });
    }
}
