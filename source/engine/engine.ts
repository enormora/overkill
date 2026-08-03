import type { WallClock } from '@enormora/wall-clock';
import type { Execute } from './execution.ts';
import { formatCaseId } from './identity.ts';
import { createRunIfMain, type RunIfMain } from './run-if-main.ts';
import {
    createTestNodeOwner,
    createTestNodeFactory,
    type Suite,
    type SuiteOptions,
    type Table,
    type TableOptions,
    type TestCase,
    type TestCaseOptions,
    type TestNode
} from './test-node.ts';
import { createTestPlanFactory, type TestPlanFactory } from './test-plan.ts';

export type Engine = {
    readonly createSuite: (options: SuiteOptions) => Suite;
    readonly createTable: (options: TableOptions) => Table;
    readonly createTestCase: (options: TestCaseOptions) => TestCase;
    readonly createTestPlan: TestPlanFactory;
    readonly execute: Execute;
    readonly formatCaseId: typeof formatCaseId;
    readonly runIfMain: RunIfMain;
};

export type EngineDependencies = {
    readonly execute: Execute;
    readonly nodeVersion: string;
    readonly readExitCode: () => number | string | null | undefined;
    readonly wallClock: WallClock;
    readonly writeExitCode: (exitCode: number) => void;
};

export function createEngine(dependencies: EngineDependencies): Engine {
    const owner = createTestNodeOwner();
    const { execute } = dependencies;
    const constructedNodes = new Set<TestNode>();
    const nodeFactory = createTestNodeFactory({
        owner,
        recordConstructedNode(node) {
            constructedNodes.add(node);
        }
    });
    const createTestPlan = createTestPlanFactory(owner, constructedNodes);

    return {
        createSuite: nodeFactory.createSuite,
        createTable: nodeFactory.createTable,
        createTestCase: nodeFactory.createTestCase,
        createTestPlan,
        execute,
        formatCaseId,
        runIfMain: createRunIfMain({
            createTestPlan,
            execute,
            nodeVersion: dependencies.nodeVersion,
            readExitCode: dependencies.readExitCode,
            wallClock: dependencies.wallClock,
            writeExitCode: dependencies.writeExitCode
        })
    };
}
