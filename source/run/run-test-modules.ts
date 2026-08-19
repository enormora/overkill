import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { Engine } from '../engine/engine.ts';
import type { TestPlanFile } from '../engine/test-plan.ts';
import type { DiscoveredRunFile } from './run-discovery.ts';
import { invalidRequest, RunCollectionError } from './run-errors.ts';

type TestModuleNamespace = Readonly<Record<string, unknown>>;

function isTestModuleNamespace(value: unknown): value is TestModuleNamespace {
    return typeof value === 'object' && value !== null;
}

function assertNonEmptyTestPlanFiles(
    files: readonly TestPlanFile[]
): asserts files is NonEmptyReadonlyArray<TestPlanFile> {
    if (files.length === 0) {
        throw new RunCollectionError('No test modules were loaded.', { cause: null }, 'loader');
    }
}

async function importRawTestModule(file: DiscoveredRunFile): Promise<unknown> {
    try {
        return await import(file.href);
    } catch (error: unknown) {
        throw new RunCollectionError(`Failed to load test module: ${file.file}`, { cause: error }, 'loader');
    }
}

async function importTestModule(file: DiscoveredRunFile): Promise<TestModuleNamespace> {
    const moduleNamespace = await importRawTestModule(file);

    if (!isTestModuleNamespace(moduleNamespace)) {
        throw new RunCollectionError(
            `Test module namespace must be an object: ${file.file}`,
            { cause: null },
            'loader'
        );
    }

    return moduleNamespace;
}

function readTestNode(moduleNamespace: TestModuleNamespace, file: DiscoveredRunFile, engine: Engine): TestPlanFile {
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

export async function loadRunTestModules(
    files: NonEmptyReadonlyArray<DiscoveredRunFile>,
    engine: Engine
): Promise<NonEmptyReadonlyArray<TestPlanFile>> {
    const testFiles: TestPlanFile[] = [];

    for (const file of files) {
        testFiles.push(readTestNode(await importTestModule(file), file, engine));
    }

    assertNonEmptyTestPlanFiles(testFiles);

    return testFiles;
}
