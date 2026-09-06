import type { Engine } from '../engine/engine.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { discoverRunFiles, type DiscoveredRunFile } from './run-discovery.ts';
import { RunCollectionError } from './run-errors.ts';
import { loadRunTestModules } from './run-test-modules.ts';
import type { RunTestFamily } from './run-types.ts';

export type RunTestPlanInput = {
    readonly cwd: string;
    readonly engine: Engine;
    readonly paths: readonly string[];
    readonly testFamily: RunTestFamily;
};

export type RunTestPlanFromFilesInput = {
    readonly cwd: string;
    readonly engine: Engine;
    readonly files: NonEmptyReadonlyArray<DiscoveredRunFile>;
    readonly testFamily: RunTestFamily;
};

async function createRunTestPlanFromDiscoveredFiles(input: RunTestPlanFromFilesInput): Promise<TestPlan> {
    const testFiles = await loadRunTestModules(input.files, input.engine);

    try {
        return input.engine.createTestPlanFromTestFiles({
            files: testFiles,
            root: {
                metadata: { kind: input.testFamily },
                title: input.cwd
            }
        });
    } catch (error: unknown) {
        throw new RunCollectionError('Failed to collect tests from run inputs.', { cause: error }, 'loader');
    }
}

export async function createRunTestPlan(input: RunTestPlanInput): Promise<TestPlan> {
    const files = await discoverRunFiles({ cwd: input.cwd, paths: input.paths, profileFiles: null });

    return await createRunTestPlanFromDiscoveredFiles({
        cwd: input.cwd,
        engine: input.engine,
        files,
        testFamily: input.testFamily
    });
}

export async function createRunTestPlanFromFiles(input: RunTestPlanFromFilesInput): Promise<TestPlan> {
    return await createRunTestPlanFromDiscoveredFiles(input);
}
