import type { TestPlan } from '../engine/test-plan.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { RunCollectionError } from './run-errors.ts';
import { resolveRunEngine } from './run-engine-selection.ts';
import { createRunTestPlanFromFiles } from './run-test-plan.ts';
import type { DiscoveredRunFile } from './run-discovery.ts';
import type { RunCommand, RunMicrotestProfileConfig, RunOrchestratorDependencies } from './run-types.ts';

async function createTestPlan(
    command: RunCommand,
    files: NonEmptyReadonlyArray<DiscoveredRunFile>,
    dependencies: RunOrchestratorDependencies
): Promise<TestPlan> {
    const engine = await resolveRunEngine(command.engine, dependencies);

    return await createRunTestPlanFromFiles({ cwd: command.cwd, engine, files });
}

export async function createLocalTestPlan(
    command: RunCommand,
    profile: RunMicrotestProfileConfig,
    files: NonEmptyReadonlyArray<DiscoveredRunFile>,
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
        return await Promise.race([ createTestPlan(command, files, dependencies), collectionTimeout ]);
    } finally {
        dependencies.wallClock.clearTimeout(timeout);
    }
}
