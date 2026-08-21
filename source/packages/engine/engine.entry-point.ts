import { createWallClock } from '@enormora/wall-clock';
import { createEngine as createEngineInstance, type Engine } from '../../engine/engine.ts';
import { createExecute } from '../../engine/execution.ts';
import { createReporterDispatcher } from '../../engine/reporter-dispatcher.ts';
import type { RunIfMainOptions } from '../../engine/run-if-main.ts';
import type {
    RootOptions,
    SuiteOptions,
    TableOptions,
    TestCaseOptions,
    TestNode,
    TestRoot
} from '../../engine/test-node.ts';

function readProcessExitCode(): number | string | null | undefined {
    return process.exitCode;
}

function writeProcessExitCode(exitCode: number): void {
    process.exitCode = exitCode;
}

function writeStdoutLine(line: string): void {
    process.stdout.write(`${line}\n`);
}

function writeStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
}

export function createEngine(): Engine {
    const wallClock = createWallClock();

    return createEngineInstance({
        execute: createExecute({
            reporterDispatcher: createReporterDispatcher({
                stderr: { writeLine: writeStderrLine },
                stdout: { writeLine: writeStdoutLine },
                wallClock
            }),
            wallClock
        }),
        nodeVersion: process.versions.node,
        readExitCode: readProcessExitCode,
        wallClock,
        writeExitCode: writeProcessExitCode
    });
}

const defaultEngine = createEngine();

export function createRoot(options: RootOptions): ReturnType<Engine['createRoot']> {
    return defaultEngine.createRoot(options);
}

export function createSuite(options: SuiteOptions): ReturnType<Engine['createSuite']> {
    return defaultEngine.createSuite(options);
}

export function createTable(options: TableOptions): ReturnType<Engine['createTable']> {
    return defaultEngine.createTable(options);
}

export function createTestCase(options: TestCaseOptions): ReturnType<Engine['createTestCase']> {
    return defaultEngine.createTestCase(options);
}

export function createTestPlan(root: TestRoot): ReturnType<Engine['createTestPlan']> {
    return defaultEngine.createTestPlan(root);
}

export function createTestPlanFromTestFiles(
    options: Parameters<Engine['createTestPlanFromTestFiles']>[0]
): ReturnType<Engine['createTestPlanFromTestFiles']> {
    return defaultEngine.createTestPlanFromTestFiles(options);
}

export async function execute(
    testPlan: Parameters<Engine['execute']>[0],
    options?: Parameters<Engine['execute']>[1]
): ReturnType<Engine['execute']> {
    return await defaultEngine.execute(testPlan, options);
}

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
): Promise<void> {
    await defaultEngine.runIfMain(meta, testNode, options);
}

export function ownsTestNode(value: unknown): value is TestNode {
    return defaultEngine.ownsTestNode(value);
}

export type { Engine } from '../../engine/engine.ts';
export type { Execute, ExecuteExecution, ExecuteOptions } from '../../engine/execution.ts';
export type { RunIfMain, RunIfMainOptions, RunIfMainRootOptions } from '../../engine/run-if-main.ts';
export type {
    TestPlanFile,
    TestPlanFromTestFilesFactory,
    TestPlanFromTestFilesOptions
} from '../../engine/test-plan.ts';
export { formatCaseId } from '../../engine/identity.ts';
export type { CaseId, TestId } from '../../engine/identity.ts';
export type {
    DefinedReporter,
    DirectorySinkDeclaration,
    FileSinkDeclaration,
    FinalResultReporter,
    MemorySinkDeclaration,
    ManagedStandardOutputSinkDeclaration,
    RealTimeReporter,
    Reporter,
    ReporterEvent,
    RunFacts,
    SinkDeclaration,
    RawStandardOutputSinkDeclaration,
    StandardOutputSinkDeclaration,
    StreamSinkDeclaration
} from '../../engine/reporter.ts';
export type { ReporterDispatcher, ReporterDispatcherDependencies } from '../../engine/reporter-dispatcher.ts';
export {
    defineReporter,
    isReporter,
    ReporterSinkConflictError,
    validateReporterSinks
} from '../../engine/reporter.ts';
export {
    createPlainOutputRenderer,
    defineOutputRenderer,
    isOutputRenderer
} from '../../engine/reporter-output.ts';
export type {
    DefinedOutputRenderer,
    OutputIntentAnnotation,
    OutputIntentRole,
    OutputIntentSeverity,
    OutputLineIntent,
    OutputLineWriter,
    OutputRenderer,
    ReporterOutput
} from '../../engine/reporter-output.ts';
export type { AssertAssertionFacade } from '../../engine/assertion-facade.ts';
export type { RequireAssertionFacade } from '../../engine/require-assertion-facade.ts';
export type {
    AssertionOptions,
    AssertionSource,
    DeepComparable,
    FailedCheck,
    FailedCompositeCheck,
    FailedForeignCheck,
    FailedLeafCheck,
    InstanceConstructor,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation,
    SourceLocationProvider,
    SourceLocation
} from '../../assertion-protocol/assertion-node-shape.ts';
export type {
    ArrayDiffOperation,
    ByteDiffRange,
    Diff,
    DiffPathSegment,
    Hunk,
    MapDiffOperation,
    ObjectDiffOperation,
    SetDiffOperation
} from '../../diff/diff-shape.ts';
export {
    defaultSerializationBudget,
    serializeValue,
    serializeValueWithBudget
} from '../../compare/serialized-value.ts';
export type {
    SerializationBudget,
    SerializedMapEntry,
    SerializedProperty,
    SerializedPropertyKey,
    SerializedValue,
    SerializationTruncation
} from '../../compare/serialized-value.ts';
export {
    captureSourceLocation,
    unknownSourceLocation
} from '../../assertion-protocol/source-location.ts';
export type {
    ErrorMatcher,
    ExactThrownMatcher,
    SynchronousCallback,
    ThrownAssertionObservation,
    ThrownMatcher
} from '../../assertion-protocol/thrown-matcher.ts';
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
    ResourceUsageSnapshot,
    RunResourceUsage,
    RunResourceUsageTracker,
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
    CompositeAssertionChildNode,
    CompositeAssertionNode,
    ForeignAssertionNode,
    ForeignAssertionResult,
    RequireAssertionNode
} from '../../assertion-protocol/assertion-node.ts';
export type {
    TestScopeAssertContext,
    Metadata,
    RootOptions,
    Suite,
    SuiteOptions,
    Table,
    TableCase,
    TableCaseOptions,
    TableOptions,
    TestBody,
    TestCase,
    TestCaseOptions,
    TestRoot,
    TestScope,
    TestNode
} from '../../engine/test-node.ts';
export type { TestPlan, TestPlanCase, TestPlanCaseBody } from '../../engine/test-plan.ts';
