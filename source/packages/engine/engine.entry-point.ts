import { createEngine as createEngineInstance, type Engine } from '../../engine/engine.ts';
import type { SuiteOptions, TableOptions, TestCaseOptions, TestNode } from '../../engine/test-node.ts';

const defaultEngine = createEngineInstance();

export { createEngine } from '../../engine/engine.ts';

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

export type { Engine } from '../../engine/engine.ts';
export { execute } from '../../engine/execution.ts';
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
export type {
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
    TestOutcome
} from '../../engine/run-result.ts';
export type {
    AssertionFacade,
    FailedCheck,
    Metadata,
    SourceLocation,
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
    TestCompletion,
    TestNode
} from '../../engine/test-node.ts';
export type { NonEmptyReadonlyArray, TestPlan, TestPlanCase, TestPlanCaseBody } from '../../engine/test-plan.ts';
