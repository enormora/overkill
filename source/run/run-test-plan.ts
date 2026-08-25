import type { Engine } from '../engine/engine.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { discoverRunFiles } from './run-discovery.ts';
import { RunCollectionError } from './run-errors.ts';
import { loadRunTestModules } from './run-test-modules.ts';

export type RunTestPlanInput = {
    readonly cwd: string;
    readonly engine: Engine;
    readonly paths: readonly string[];
};

export async function createRunTestPlan(input: RunTestPlanInput): Promise<TestPlan> {
    const files = await discoverRunFiles({ cwd: input.cwd, paths: input.paths });
    const testFiles = await loadRunTestModules(files, input.engine);

    try {
        return input.engine.createTestPlanFromTestFiles({
            files: testFiles,
            root: {
                metadata: {},
                name: input.cwd
            }
        });
    } catch (error: unknown) {
        throw new RunCollectionError('Failed to collect tests from explicit run inputs.', { cause: error }, 'loader');
    }
}
