import type { Clock } from '@enormora/clock';
import type { Execute, ExecutionDriver } from './execution.ts';
import {
    createFamilyRuns,
    type CollectedFamilyRun,
    type PrepareFamilyRequest,
    type PreparedFamilyRun
} from './family-run.ts';
import type { FamilyValue } from './test-family.ts';
import { formatCaseId } from './identity.ts';
import {
    createTestNodeOwner,
    createTestNodeFactory,
    type PropertyTestCaseOptions,
    type BenchmarkTestCaseOptions,
    type TestNodeOwner,
    isOwnedTestNode,
    type RootOptions,
    type Suite,
    type SkippedTestCaseOptions,
    type SuiteOptions,
    type Table,
    type TableOptions,
    type TestCase,
    type TestCaseOptions,
    type TestNode,
    type TestRoot,
    type ThrowingTestCaseOptions,
    type WorkloadTestCaseOptions
} from './test-node.ts';
import {
    createTestPlanFactory,
    createTestPlanFromTestFilesFactory,
    type TestPlan,
    type TestPlanFactory,
    type TestPlanFromTestFilesFactory
} from './test-plan.ts';

export type Engine = {
    readonly createPropertyTestCase: (options: PropertyTestCaseOptions) => TestCase;
    readonly createBenchmarkTestCase: (options: BenchmarkTestCaseOptions) => TestCase;
    readonly createRoot: (options: RootOptions) => TestRoot;
    readonly createSuite: (options: SuiteOptions) => Suite;
    readonly createSkippedTestCase: (options: SkippedTestCaseOptions) => TestCase;
    readonly createTable: (options: TableOptions) => Table;
    readonly createTestCase: (options: TestCaseOptions) => TestCase;
    readonly createThrowingTestCase: (options: ThrowingTestCaseOptions) => TestCase;
    readonly createWorkloadTestCase: (options: WorkloadTestCaseOptions) => TestCase;
    readonly createTestPlan: TestPlanFactory;
    readonly createTestPlanFromTestFiles: TestPlanFromTestFilesFactory;
    readonly execute: Execute;
    readonly prepareFamily: <Settings extends FamilyValue>(
        request: PrepareFamilyRequest<Settings>
    ) => Promise<PreparedFamilyRun>;
    readonly formatCaseId: typeof formatCaseId;
    readonly ownsTestNode: (value: unknown) => value is TestNode;
};

export type EngineDependencies = {
    readonly execute: ExecutionDriver;
    readonly wallClock: Clock;
};

function isTestPlan(input: CollectedFamilyRun | TestPlan): input is TestPlan {
    return Object.hasOwn(input, 'cases');
}

export function createEngineWithOwner(dependencies: EngineDependencies, owner: TestNodeOwner): Engine {
    const { execute } = dependencies;
    const constructedNodes = new Set<TestNode>();
    const nodeFactory = createTestNodeFactory({
        owner,
        recordConstructedNode(node) {
            constructedNodes.add(node);
        }
    });
    const planFromRoot = createTestPlanFactory(owner, constructedNodes);
    const planFromFiles = createTestPlanFromTestFilesFactory(owner, nodeFactory.createRoot);

    const plans = new WeakSet<TestPlan>();
    const familyRuns = createFamilyRuns(function ownsPlan(plan) {
        return plans.has(plan);
    });

    return {
        createPropertyTestCase: nodeFactory.createPropertyTestCase,
        createBenchmarkTestCase: nodeFactory.createBenchmarkTestCase,
        createRoot: nodeFactory.createRoot,
        createSuite: nodeFactory.createSuite,
        createSkippedTestCase: nodeFactory.createSkippedTestCase,
        createTable: nodeFactory.createTable,
        createTestCase: nodeFactory.createTestCase,
        createThrowingTestCase: nodeFactory.createThrowingTestCase,
        createWorkloadTestCase: nodeFactory.createWorkloadTestCase,
        createTestPlan(root) {
            const plan = planFromRoot(root);
            plans.add(plan);
            return plan;
        },
        createTestPlanFromTestFiles(options) {
            const plan = planFromFiles(options);
            plans.add(plan);
            return plan;
        },
        prepareFamily: familyRuns.prepareFamily,
        async execute(input, options?) {
            if (isTestPlan(input)) {
                return await execute(input, options);
            }
            const signal: unknown = options === undefined ? undefined : Reflect.get(options, 'signal');
            if (!(signal instanceof AbortSignal)) {
                throw new TypeError('Collected family execution requires an AbortSignal.');
            }
            return await execute(familyRuns.execution(input, signal), options);
        },
        formatCaseId,
        ownsTestNode(value): value is TestNode {
            return isOwnedTestNode(value, owner);
        }
    };
}

export function createEngine(dependencies: EngineDependencies): Engine {
    return createEngineWithOwner(dependencies, createTestNodeOwner());
}
