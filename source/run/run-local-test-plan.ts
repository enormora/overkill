import type { TestPlan } from '../engine/test-plan.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { DefinitionLocationCapture } from './definition-location-capture.ts';
import { RunCollectionError } from './run-errors.ts';
import { resolveRunEngine } from './run-engine-selection.ts';
import { createRunTestPlanFromFiles } from './run-test-plan.ts';
import type { DiscoveredRunFile } from './run-discovery-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand, RunProfileConfig } from './run-types.ts';

type LocalTestPlanInput = {
    readonly command: RunCommand;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly dependencies: RunOrchestratorDependencies;
    readonly files: NonEmptyReadonlyArray<DiscoveredRunFile>;
    readonly profile: RunProfileConfig;
};

async function createTestPlan(input: LocalTestPlanInput): Promise<TestPlan> {
    const engine = await resolveRunEngine(input.command.engine, input.dependencies);

    return await createRunTestPlanFromFiles({
        cwd: input.command.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine,
        files: input.files,
        loadRunTestModules: input.dependencies.loadRunTestModules,
        testFamily: input.profile.testFamily
    });
}

export async function createLocalTestPlan(input: LocalTestPlanInput): Promise<TestPlan> {
    let rejectCollection: (error: RunCollectionError) => void = function ignoreReject() {
        return undefined;
    };
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
        return await Promise.race([ createTestPlan(input), collectionTimeout ]);
    } finally {
        input.dependencies.wallClock.clearTimeout(timeout);
    }
}
