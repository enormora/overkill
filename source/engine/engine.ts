import { execute } from './execution.ts';
import { formatCaseId } from './identity.ts';
import {
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
    readonly execute: typeof execute;
    readonly formatCaseId: typeof formatCaseId;
};

export function createEngine(): Engine {
    const owner = {};
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
        execute,
        formatCaseId
    };
}

const defaultEngine = createEngine();

export function createSuite(options: SuiteOptions): ReturnType<Engine['createSuite']> {
    return defaultEngine.createSuite(options);
}

export function createTable(options: TableOptions): ReturnType<Engine['createTable']> {
    return defaultEngine.createTable(options);
}

export function createTestCase(options: TestCaseOptions): ReturnType<Engine['createTestCase']> {
    return defaultEngine.createTestCase(options);
}

export function createTestPlan(root: TestNode): ReturnType<Engine['createTestPlan']> {
    return defaultEngine.createTestPlan(root);
}

export { execute, formatCaseId };
