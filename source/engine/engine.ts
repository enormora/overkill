import type { WallClock } from '@enormora/wall-clock';
import type { Execute } from './execution.ts';
import { formatCaseId } from './identity.ts';
import { createRunIfMain, type RunIfMain } from './run-if-main.ts';
import {
    createTestNodeOwner,
    createTestNodeFactory,
    type TestNodeOwner,
    isOwnedTestNode,
    type RootOptions,
    type Suite,
    type SuiteOptions,
    type Table,
    type TableOptions,
    type TestCase,
    type TestCaseOptions,
    type TestNode,
    type TestRoot
} from './test-node.ts';
import {
    createTestPlanFactory,
    createTestPlanFromTestFilesFactory,
    type TestPlanFactory,
    type TestPlanFromTestFilesFactory
} from './test-plan.ts';

export type Engine = {
    readonly createRoot: (options: RootOptions) => TestRoot;
    readonly createSuite: (options: SuiteOptions) => Suite;
    readonly createTable: (options: TableOptions) => Table;
    readonly createTestCase: (options: TestCaseOptions) => TestCase;
    readonly createTestPlan: TestPlanFactory;
    readonly createTestPlanFromTestFiles: TestPlanFromTestFilesFactory;
    readonly execute: Execute;
    readonly formatCaseId: typeof formatCaseId;
    readonly ownsTestNode: (value: unknown) => value is TestNode;
    readonly runIfMain: RunIfMain;
};

export type EngineDependencies = {
    readonly execute: Execute;
    readonly nodeVersion: string;
    readonly readExitCode: () => number | string | null | undefined;
    readonly wallClock: WallClock;
    readonly writeExitCode: (exitCode: number) => void;
};

export function createEngineWithOwner(dependencies: EngineDependencies, owner: TestNodeOwner): Engine {
    const { execute } = dependencies;
    const constructedNodes = new Set<TestNode>();
    const nodeFactory = createTestNodeFactory({
        owner,
        recordConstructedNode(node) {
            constructedNodes.add(node);
        }
    });
    const createTestPlan = createTestPlanFactory(owner, constructedNodes);
    const createTestPlanFromTestFiles = createTestPlanFromTestFilesFactory(owner, nodeFactory.createRoot);

    return {
        createRoot: nodeFactory.createRoot,
        createSuite: nodeFactory.createSuite,
        createTable: nodeFactory.createTable,
        createTestCase: nodeFactory.createTestCase,
        createTestPlan,
        createTestPlanFromTestFiles,
        execute,
        formatCaseId,
        ownsTestNode(value): value is TestNode {
            return isOwnedTestNode(value, owner);
        },
        runIfMain: createRunIfMain({
            createRoot: nodeFactory.createRoot,
            createTestPlan,
            execute,
            nodeVersion: dependencies.nodeVersion,
            readExitCode: dependencies.readExitCode,
            wallClock: dependencies.wallClock,
            writeExitCode: dependencies.writeExitCode
        })
    };
}

export function createEngine(dependencies: EngineDependencies): Engine {
    return createEngineWithOwner(dependencies, createTestNodeOwner());
}
