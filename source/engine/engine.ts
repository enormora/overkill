import type { WallClock } from '@enormora/wall-clock';
import { createExecute, type Execute } from './execution.ts';
import { formatCaseId } from './identity.ts';
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
};

export type EngineDependencies = {
    readonly wallClock: WallClock;
};

export function createEngine(dependencies: EngineDependencies): Engine {
    const owner = createTestNodeOwner();
    const { wallClock } = dependencies;
    const constructedNodes = new Set<TestNode>();
    const nodeFactory = createTestNodeFactory({
        owner,
        recordConstructedNode(node) {
            constructedNodes.add(node);
        }
    });

    return {
        createSuite: nodeFactory.createSuite,
        createTable: nodeFactory.createTable,
        createTestCase: nodeFactory.createTestCase,
        createTestPlan: createTestPlanFactory(owner, constructedNodes),
        execute: createExecute({ wallClock }),
        formatCaseId
    };
}
