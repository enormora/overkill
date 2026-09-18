import type { Engine } from '../engine/engine.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import {
    withDefinitionLocationCapture,
    type DefinitionLocationCapture
} from './definition-location-capture.ts';
import type { DiscoveredRunFile, RunDiscovery } from './run-discovery-types.ts';
import { RunCollectionError } from './run-errors.ts';
import { expandRuntimeMatrices } from './runtime-matrix-expansion.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';
import type { RunTestFamily } from './run-types.ts';

export type RunTestPlanInput = {
    readonly cwd: string;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly discoverRunFiles: RunDiscovery['discoverRunFiles'];
    readonly engine: Engine;
    readonly loadRunTestModules: RunTestModuleLoader;
    readonly paths: readonly string[];
    readonly testFamily: RunTestFamily;
};

export type RunTestPlanFromFilesInput = {
    readonly cwd: string;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly engine: Engine;
    readonly files: NonEmptyReadonlyArray<DiscoveredRunFile>;
    readonly loadRunTestModules: RunTestModuleLoader;
    readonly testFamily: RunTestFamily;
};

async function createRunTestPlanFromDiscoveredFiles(input: RunTestPlanFromFilesInput): Promise<TestPlan> {
    return await withDefinitionLocationCapture(
        input.definitionLocationCapture,
        async function createPlanWithDefinitionLocationCapture() {
            const testFiles = await input.loadRunTestModules(input.files, input.engine);

            try {
                return expandRuntimeMatrices(input.engine.createTestPlanFromTestFiles({
                    files: testFiles,
                    root: {
                        annotations: {},
                        controls: {},
                        title: input.cwd
                    }
                }));
            } catch (error: unknown) {
                throw new RunCollectionError('Failed to collect tests from run inputs.', { cause: error }, 'loader');
            }
        }
    );
}

export async function createRunTestPlan(input: RunTestPlanInput): Promise<TestPlan> {
    const files = await input.discoverRunFiles({ cwd: input.cwd, paths: input.paths, profileFiles: null });

    return await createRunTestPlanFromDiscoveredFiles({
        cwd: input.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine: input.engine,
        files,
        loadRunTestModules: input.loadRunTestModules,
        testFamily: input.testFamily
    });
}

export async function createRunTestPlanFromFiles(input: RunTestPlanFromFilesInput): Promise<TestPlan> {
    return await createRunTestPlanFromDiscoveredFiles(input);
}
