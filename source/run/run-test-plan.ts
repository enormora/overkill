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
import type {
    DirectEntrypointRunCollectionSource,
    RunCollectionSource
} from './run-collection-source-types.ts';
import type {
    RunCollectionRoot,
    RunTestFamily
} from './run-types.ts';

export type RunTestPlanCollectionSource = RunCollectionSource;

export type RunTestPlanInput = {
    readonly cwd: string;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly discoverRunFiles: RunDiscovery['discoverRunFiles'];
    readonly engine: Engine;
    readonly loadRunTestModules: RunTestModuleLoader;
    readonly paths: readonly string[];
    readonly root: RunCollectionRoot;
    readonly testFamily: RunTestFamily;
};

export type RunTestPlanFromFilesInput = {
    readonly cwd: string;
    readonly definitionLocationCapture: DefinitionLocationCapture;
    readonly engine: Engine;
    readonly files: NonEmptyReadonlyArray<DiscoveredRunFile>;
    readonly loadRunTestModules: RunTestModuleLoader;
    readonly root: RunCollectionRoot;
    readonly testFamily: RunTestFamily;
};

export function createRunTestPlanFromDirectEntrypoint(
    engine: Engine,
    file: DiscoveredRunFile,
    source: DirectEntrypointRunCollectionSource
): TestPlan {
    try {
        return expandRuntimeMatrices(engine.createTestPlanFromTestFiles({
            files: [ { file: file.file, testNode: source.testNode } ],
            root: source.root
        }));
    } catch (error: unknown) {
        throw new RunCollectionError('Failed to collect tests from runIfMain().', { cause: error }, 'loader');
    }
}

async function createRunTestPlanFromDiscoveredFiles(input: RunTestPlanFromFilesInput): Promise<TestPlan> {
    return await withDefinitionLocationCapture(
        input.definitionLocationCapture,
        async function createPlanWithDefinitionLocationCapture() {
            const testFiles = await input.loadRunTestModules(input.files, input.engine);

            try {
                return expandRuntimeMatrices(input.engine.createTestPlanFromTestFiles({
                    files: testFiles,
                    root: input.root
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
        root: input.root,
        testFamily: input.testFamily
    });
}

export async function createRunTestPlanFromFiles(input: RunTestPlanFromFilesInput): Promise<TestPlan> {
    return await createRunTestPlanFromDiscoveredFiles(input);
}
