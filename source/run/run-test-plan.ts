import type { Engine } from '../engine/engine.ts';
import type { TestPlanCollectionPolicy } from '../engine/plan-collection-policy.ts';
import { bindWireReplayPlan } from './replay-wire.ts';
import {
    withDefinitionLocationCapture,
    type DefinitionLocationCapture
} from './definition-location-capture.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import type {
    DiscoveredRunFile,
    DirectEntrypointRunCollectionSource,
    RunCollectionSource,
    RunCollectionRoot,
    RunTestFamily,
    ReplayWire
} from './run-types.ts';
import { RunCollectionError } from './run-errors.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';

const runtimeCollectionPolicy: TestPlanCollectionPolicy = {
    runtimeMatrices: true,
    benchmarkCalibration: false,
    property: null
};

type TestPlan = ReturnType<Engine['createTestPlan']>;

export type RunTestPlanCollectionSource = RunCollectionSource;

export type RunTestPlanInput = {
    readonly replay: ReplayWire | null;
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
    readonly files: readonly [DiscoveredRunFile, ...readonly DiscoveredRunFile[]];
    readonly loadRunTestModules: RunTestModuleLoader;
    readonly root: RunCollectionRoot;
    readonly testFamily: RunTestFamily;
};

export function createRunTestPlanFromDirectEntrypoint(
    engine: Engine,
    file: DiscoveredRunFile,
    source: DirectEntrypointRunCollectionSource,
    ...policies: readonly [] | readonly [TestPlanCollectionPolicy]
): TestPlan {
    const policy = policies[0] ?? runtimeCollectionPolicy;
    try {
        return engine.createTestPlanFromTestFiles({
            files: [ { file: file.file, testNode: source.testNode } ],
            root: source.root
        }, policy);
    } catch (error: unknown) {
        throw RunCollectionError.fromPlan(error, 'Failed to collect tests from runIfMain().');
    }
}

async function createRunTestPlanFromDiscoveredFiles(
    input: RunTestPlanFromFilesInput,
    policy: TestPlanCollectionPolicy
): Promise<TestPlan> {
    return await withDefinitionLocationCapture(
        input.definitionLocationCapture,
        async function createPlanWithDefinitionLocationCapture() {
            const testFiles = await input.loadRunTestModules(input.files, input.engine);

            try {
                return input.engine.createTestPlanFromTestFiles({
                    files: testFiles,
                    root: input.root
                }, policy);
            } catch (error: unknown) {
                throw RunCollectionError.fromPlan(error, 'Failed to collect tests from run inputs.');
            }
        }
    );
}

export async function createRunTestPlan(
    input: RunTestPlanInput,
    ...policies: readonly [] | readonly [TestPlanCollectionPolicy]
): Promise<TestPlan> {
    const files = await input.discoverRunFiles({ cwd: input.cwd, paths: input.paths, profileFiles: null });

    const plan = await createRunTestPlanFromDiscoveredFiles({
        cwd: input.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine: input.engine,
        files,
        loadRunTestModules: input.loadRunTestModules,
        root: input.root,
        testFamily: input.testFamily
    }, policies[0] ?? runtimeCollectionPolicy);
    return bindWireReplayPlan(plan, input.replay);
}

export async function createRunTestPlanFromFiles(
    input: RunTestPlanFromFilesInput,
    ...policies: readonly [] | readonly [TestPlanCollectionPolicy]
): Promise<TestPlan> {
    return await createRunTestPlanFromDiscoveredFiles(input, policies[0] ?? runtimeCollectionPolicy);
}
