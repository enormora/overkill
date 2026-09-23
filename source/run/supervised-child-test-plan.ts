import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from '../engine/execution-global-error-observer.ts';
import type { RunnerError, TestPlan } from '../packages/engine/engine.entry-point.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { RunCollectionError } from './run-errors.ts';
import { createRunTestPlan } from './run-test-plan.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import { assertTestPlanMatchesTestFamily } from './run-selection.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';

export type SupervisedChildTestPlanDependencies = {
    readonly discoverRunFiles: RunDiscovery['discoverRunFiles'];
    readonly loadRunEngineModule: RunEngineModuleLoader;
    readonly loadRunTestModules: RunTestModuleLoader;
};

type SelectedSupervisedEngine = Awaited<ReturnType<SupervisedChildTestPlanDependencies['loadRunEngineModule']>>;
const missingObservedChildError: RunnerError = {
    attributedTo: null,
    attributedToWork: null,
    cause: null,
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
        attributedTo: null,
        attributedToWork: null,
        cause: error,
        message: error instanceof Error ? error.message : String(error),
        subtype: 'loader'
    };
}

export async function runObservedSupervisedChildCommand(run: () => Promise<void>): Promise<void> {
    const globalErrorObserver = createExecutionGlobalErrorObserver('supervised-child');

    try {
        await globalErrorObserver.runBoundary(async function runObservedCommand() {
            await globalErrorObserver.runPhase('collection', async function completeObservedCommand() {
                await Promise.race([
                    run(),
                    waitForObservedChildError(globalErrorObserver)
                ]);
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
    const testPlan = await createRunTestPlan({
        cwd: command.cwd,
        definitionLocationCapture: command.definitionLocationCapture,
        discoverRunFiles: dependencies.discoverRunFiles,
        engine,
        loadRunTestModules: dependencies.loadRunTestModules,
        paths: command.paths,
        testFamily: command.testFamily
    });

    assertTestPlanMatchesTestFamily(testPlan, command.testFamily);

    return testPlan;
}
