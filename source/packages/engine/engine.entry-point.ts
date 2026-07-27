import { createWallClock } from '@enormora/wall-clock';
import { createEngine as createEngineInstance, type Engine } from '../../engine/engine.ts';
import { createExecute } from '../../engine/execution.ts';
import { createReporterDispatcher } from '../../engine/reporter.ts';
import type { SuiteOptions, TableOptions, TestCaseOptions, TestNode } from '../../engine/test-node.ts';

export function createEngine(): Engine {
    const wallClock = createWallClock();

    return createEngineInstance({
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({ wallClock }),
            wallClock
        })
    });
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

export async function execute(
    testPlan: Parameters<Engine['execute']>[0],
    options?: Parameters<Engine['execute']>[1]
): ReturnType<Engine['execute']> {
    return await defaultEngine.execute(testPlan, options);
}

export type { Engine } from '../../engine/engine.ts';
export type { Execute, ExecuteOptions } from '../../engine/execution.ts';
export { formatCaseId } from '../../engine/identity.ts';
export type { CaseId, TestId } from '../../engine/identity.ts';
export type {
    DirectorySinkDeclaration,
    FileSinkDeclaration,
    FinalResultReporter,
    MemorySinkDeclaration,
    RealTimeReporter,
    Reporter,
    ReporterEvent,
    RunFacts,
    SinkDeclaration,
    StandardOutputSinkDeclaration,
    StreamSinkDeclaration
} from '../../engine/reporter.ts';
export { validateReporterSinks } from '../../engine/reporter.ts';
export type { AssertAssertionFacade, RequireAssertionFacade } from '../../assertion-protocol/catalog.ts';
export type {
    AssertionOptions,
    AssertionSource,
    FailedCheck,
    InstanceConstructor,
    NonEmptyReadonlyArray,
    SourceLocation
} from '../../assertion-protocol/assertion-node-shape.ts';
export type { FalseAssertionNode, TrueAssertionNode } from '../../assertion-protocol/assertions/boolean.ts';
export type {
    EmptinessAssertionNode,
    LengthAssertionNode
} from '../../assertion-protocol/assertions/collection.ts';
export type {
    DeepEqualAssertionNode,
    EqualAssertionNode,
    NotDeepEqualAssertionNode,
    NotEqualAssertionNode
} from '../../assertion-protocol/assertions/equality.ts';
export type { FailAssertionNode } from '../../assertion-protocol/assertions/fail.ts';
export type {
    BetweenAssertionNode,
    NumericComparisonAssertionNode
} from '../../assertion-protocol/assertions/numeric.ts';
export type {
    ArrayContainsPartialAssertionNode,
    MembersPartialDeepEqualAssertionNode,
    PartialDeepEqualAssertionNode
} from '../../assertion-protocol/assertions/partial.ts';
export type {
    DefinedAssertionNode,
    NotNullAssertionNode,
    NullAssertionNode,
    UndefinedAssertionNode
} from '../../assertion-protocol/assertions/presence.ts';
export type {
    MatchAssertionNode,
    StringContainsAssertionNode
} from '../../assertion-protocol/assertions/string.ts';
export type {
    HasPropertyAssertionNode,
    InstanceOfAssertionNode,
    TypeAssertionNode
} from '../../assertion-protocol/assertions/type-shape.ts';
export type {
    AssertionTestFailure,
    BodyErrorTestFailure,
    FailOutcome,
    InconclusiveOutcome,
    OrphanedNode,
    PassOutcome,
    PerTestResult,
    RunResult,
    RunnerError,
    RunSummary,
    SkipOutcome,
    SuiteRunCounts,
    TestContractFailure,
    TestContractFailureCode,
    TestFailure,
    TestOutcome
} from '../../engine/run-result.ts';
export type {
    AssertAssertionNode,
    AssertionNode,
    AssertionResult,
    RequireAssertionNode
} from '../../assertion-protocol/assertion-node.ts';
export type {
    CaseAssertContext,
    Metadata,
    Suite,
    SuiteOptions,
    Table,
    TableCase,
    TableCaseOptions,
    TableOptions,
    TestBody,
    TestCase,
    TestCaseOptions,
    TestContext,
    TestNode
} from '../../engine/test-node.ts';
export type { TestPlan, TestPlanCase, TestPlanCaseBody } from '../../engine/test-plan.ts';
