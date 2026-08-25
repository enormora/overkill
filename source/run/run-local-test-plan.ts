import type { TestPlan } from '../engine/test-plan.ts';
import { RunCollectionError } from './run-errors.ts';
import { resolveRunEngine } from './run-engine-selection.ts';
import { createRunTestPlan } from './run-test-plan.ts';
import type { RunCommand, RunMicrotestProfileConfig, RunOrchestratorDependencies } from './run-types.ts';

async function createTestPlan(command: RunCommand, dependencies: RunOrchestratorDependencies): Promise<TestPlan> {
    const engine = await resolveRunEngine(command.engine, dependencies);

    return await createRunTestPlan({ cwd: command.cwd, engine, paths: command.request.paths });
}

export async function createLocalTestPlan(
    command: RunCommand,
    profile: RunMicrotestProfileConfig,
    dependencies: RunOrchestratorDependencies
): Promise<TestPlan> {
    let rejectCollection: (error: RunCollectionError) => void = function ignoreReject() {
        return undefined;
    };
    const collectionTimeout = new Promise<never>(function rejectOnCollectionTimeout(_resolve, reject) {
        rejectCollection = reject;
    });
    const timeout = dependencies.wallClock.setTimeout(function failTimedOutCollection() {
        rejectCollection(
            new RunCollectionError(
                'Collection exceeded collection timeout.',
                { cause: null },
                'loader'
            )
        );
    }, profile.timeouts.collectionMilliseconds);

    try {
        return await Promise.race([ createTestPlan(command, dependencies), collectionTimeout ]);
    } finally {
        dependencies.wallClock.clearTimeout(timeout);
    }
}
