import type { TestPlan } from '../engine/test-plan.ts';

import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from '../engine/execution-global-error-observer.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';

import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import { RunCollectionError } from './run-errors.ts';
import { resolveRunEngine } from './run-engine-selection.ts';
import {
    createRunTestPlanFromDirectEntrypoint,
    createRunTestPlanFromFiles,
    type RunTestPlanCollectionSource
} from './run-test-plan.ts';

import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand } from './run-types.ts';

export type LocalTestPlanInput = Pick<ResolvedRunInput, 'files' | 'profile'> & {
    readonly command: RunCommand;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly dependencies: RunOrchestratorDependencies;
    readonly source: RunTestPlanCollectionSource;
};
export type LocalTestPlan = TestPlan;

async function createTestPlan(input: LocalTestPlanInput): Promise<TestPlan> {
    const engine = await resolveRunEngine(input.command.engine, input.dependencies);

    if (input.source.kind === 'direct-entrypoint') {
        const [ file ] = input.files;

        return createRunTestPlanFromDirectEntrypoint(engine, file, input.source);
    }

    return await createRunTestPlanFromFiles({
        cwd: input.command.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine,
        files: input.files,
        loadRunTestModules: input.dependencies.loadRunTestModules,
        root: { annotations: {}, controls: {}, title: input.command.cwd },
        testFamily: input.profile.testFamily
    });
}

function firstObservedCollectionError(observer: ExecutionGlobalErrorObserver): RunCollectionError {
    const [ error ] = observer.takeErrors();

    return new RunCollectionError(
        error?.message ?? 'Collection failed after a process-level runtime error.',
        { cause: error ?? null },
        error?.subtype ?? 'crash'
    );
}

async function waitForObservedCollectionError(observer: ExecutionGlobalErrorObserver): Promise<never> {
    await observer.fatalSignal();
    throw firstObservedCollectionError(observer);
}

export async function createLocalTestPlan(input: LocalTestPlanInput): Promise<TestPlan> {
    let rejectCollection: (error: RunCollectionError) => void = function ignoreReject() {
        return undefined;
    };
    const globalErrorObserver = createExecutionGlobalErrorObserver('in-process');
    const collectionTimeout = new Promise<never>(function rejectOnCollectionTimeout(_resolve, reject) {
        rejectCollection = reject;
    });
    const timeout = input.dependencies.wallClock.setTimeout(function failTimedOutCollection() {
        rejectCollection(
            new RunCollectionError(
                'Collection exceeded collection timeout.',
                { cause: null },
                'loader'
            )
        );
    }, input.profile.timeouts.collectionMilliseconds);

    try {
        return await globalErrorObserver.runBoundary(async function runObservedCollection() {
            return await globalErrorObserver.runPhase('collection', async function collectObservedTestPlan() {
                return await Promise.race([
                    createTestPlan(input),
                    collectionTimeout,
                    waitForObservedCollectionError(globalErrorObserver)
                ]);
            });
        });
    } finally {
        input.dependencies.wallClock.clearTimeout(timeout);
        globalErrorObserver.stop();
    }
}
