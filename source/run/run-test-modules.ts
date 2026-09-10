import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { Engine } from '../engine/engine.ts';
import type { TestPlanFromTestFilesOptions } from '../engine/test-plan.ts';
import type { DiscoveredRunFile } from './run-discovery-types.ts';
import { invalidRequest, RunCollectionError } from './run-errors.ts';

type TestModuleNamespace = Readonly<Record<string, unknown>>;
type RunTestFile = TestPlanFromTestFilesOptions['files'][number];
export type RunTestModuleLoader = (
    files: NonEmptyReadonlyArray<DiscoveredRunFile>,
    engine: Engine
) => Promise<NonEmptyReadonlyArray<RunTestFile>>;
export type RunTestModuleLoaderDependencies = {
    readonly importModule: (href: string) => Promise<unknown>;
};

function isTestModuleNamespace(value: unknown): value is TestModuleNamespace {
    return typeof value === 'object' && value !== null;
}

async function importRawTestModule(
    file: DiscoveredRunFile,
    dependencies: RunTestModuleLoaderDependencies
): Promise<unknown> {
    try {
        return await dependencies.importModule(file.href);
    } catch (error: unknown) {
        throw new RunCollectionError(`Failed to load test module: ${file.file}`, { cause: error }, 'loader');
    }
}

async function importTestModule(
    file: DiscoveredRunFile,
    dependencies: RunTestModuleLoaderDependencies
): Promise<TestModuleNamespace> {
    const moduleNamespace = await importRawTestModule(file, dependencies);

    if (!isTestModuleNamespace(moduleNamespace)) {
        throw new RunCollectionError(
            `Test module namespace must be an object: ${file.file}`,
            { cause: null },
            'loader'
        );
    }

    return moduleNamespace;
}

async function loadRunTestModule(
    file: DiscoveredRunFile,
    engine: Engine,
    dependencies: RunTestModuleLoaderDependencies
): Promise<RunTestFile> {
    const moduleNamespace = await importTestModule(file, dependencies);

    if (!Object.hasOwn(moduleNamespace, 'testNode')) {
        invalidRequest(`Test module must export testNode: ${file.file}`);
    }

    const { testNode } = moduleNamespace;

    if (!engine.ownsTestNode(testNode)) {
        invalidRequest(`Test module testNode must be created by the selected engine: ${file.file}`);
    }

    return {
        file: file.file,
        testNode
    };
}

export function createRunTestModuleLoader(dependencies: RunTestModuleLoaderDependencies): RunTestModuleLoader {
    return async function loadRunTestModules(files, engine) {
        const [ firstFile, ...remainingFiles ] = files;
        const firstTestFile = await loadRunTestModule(firstFile, engine, dependencies);
        const remainingTestFiles: RunTestFile[] = [];

        for (const file of remainingFiles) {
            remainingTestFiles.push(await loadRunTestModule(file, engine, dependencies));
        }

        return [ firstTestFile, ...remainingTestFiles ];
    };
}
