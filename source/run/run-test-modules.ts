import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { Engine } from '../engine/engine.ts';
import type { TestPlanFile } from '../engine/test-plan.ts';
import type { DiscoveredRunFile } from './run-discovery.ts';
import { invalidRequest, RunCollectionError } from './run-errors.ts';

type TestModuleNamespace = Readonly<Record<string, unknown>>;

async function importUnknownModule(href: string): Promise<unknown> {
    return await import(href) as unknown;
}

function isTestModuleNamespace(value: unknown): value is TestModuleNamespace {
    return typeof value === 'object' && value !== null;
}

async function importRawTestModule(file: DiscoveredRunFile): Promise<unknown> {
    try {
        return await importUnknownModule(file.href);
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
    const [ firstFile, ...remainingFiles ] = files;
    const firstTestFile = readTestNode(await importTestModule(firstFile), firstFile, engine);
    const remainingTestFiles: TestPlanFile[] = [];

    for (const file of remainingFiles) {
        remainingTestFiles.push(readTestNode(await importTestModule(file), file, engine));
    }

    return [ firstTestFile, ...remainingTestFiles ];
}
