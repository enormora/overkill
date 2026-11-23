import { withAssertionSettlement } from './assertion-lifetime.ts';
import { withLateAssertionDelivery, type LateAssertionDelivery } from './late-assertion-delivery.ts';
import { withResourceCheckReporting } from './resource-check-reporting.ts';
import { withPreparedBodyPlan } from './body-reference-plan.ts';
import { executeFamilyWork } from './family-execution.ts';
import {
    disposeFamily,
    rejectFamilyExecution,
    type CollectedFamilyRun,
    type FamilyExecuteOptions,
    type FamilyExecutionRequest
} from './family-run.ts';
import type {
    ExecuteExecution as ExecuteExecutionDefinition,
    ExecuteOptions as ExecuteOptionsDefinition,
    NormalizedExecuteOptions
} from './execution-options.ts';
import { appendRunnerErrors, createRunResult, throwWithCleanupErrors } from './execution-result.ts';
import {
    createReporterDisposal,
    type ReporterDelivery,
    type ReporterDisposal
} from './reporter-dispatcher.ts';
import { reportRunnerErrors } from './runner-error-reporting.ts';
import type { RunResult, RunnerError } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';
import {
    withPreparedExecution,
    type ExecuteDependencies as PreparationDependencies,
    type PreparedExecution
    // eslint-disable-next-line import/max-dependencies -- This orchestration boundary consumes the resource-check protocol directly.
} from './execution-preparation.ts';

export type ExecuteDependencies = PreparationDependencies;

export type ExecuteExecution = ExecuteExecutionDefinition;
export type ExecuteOptions = ExecuteOptionsDefinition;

type ExecuteRunInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly reporterDisposal: ReporterDisposal;
    readonly testPlan: TestPlan;
    readonly family: FamilyExecutionRequest | null;
};

type ExecutionReportingContext = {
    readonly dependencies: PreparedExecution['dependencies'];
    readonly reporterDelivery: ReporterDelivery;
};

async function disposeFamilyBeforeDelivery(
    input: ExecuteRunInput
): Promise<readonly RunnerError[]> {
    return await reportRunnerErrors(input.context.reporterDelivery, await disposeFamily(input.family));
}

async function createRunResultBeforeRunEnd(input: ExecuteRunInput): Promise<RunResult> {
    const { testPlan, options, context: { dependencies, reporterDelivery } } = input;
    const startedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);
    const startErrors = await reporterDelivery.reportEvent({
        facts: options.runFacts,
        kind: 'run-start',
        root: testPlan.root,
        startedAt: options.startedAt
    });
    const loadRuntimePolicyErrors = await reportRunnerErrors(
        reporterDelivery,
        options.runtimePolicy?.takePendingRunErrors() ?? []
    );
    const { executedTestPlan, processUsage } = await executeFamilyWork(input);
    const finalRuntimePolicyErrors = await reportRunnerErrors(
        reporterDelivery,
        options.runtimePolicy?.takeRunErrors() ?? []
    );
    const finalGlobalErrorObserverErrors = await reportRunnerErrors(
        reporterDelivery,
        dependencies.globalErrorObserver.takeErrors()
    );
    const reporterErrors = [
        ...await disposeFamilyBeforeDelivery(input),
        ...startErrors,
        ...loadRuntimePolicyErrors,
        ...executedTestPlan.reporterErrors,
        ...finalRuntimePolicyErrors,
        ...finalGlobalErrorObserverErrors
    ];

    const result = createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
        completedAtMicroseconds: Number(dependencies.wallClock.currentMonotonicMicroseconds),
        planStatus: 'planned',
        processUsage,
        startedAtMicroseconds,
        testExecutionWallTimeMicroseconds: executedTestPlan.testExecutionWallTimeMicroseconds
    });
    return {
        ...result,
        artifacts: [ ...result.artifacts, ...executedTestPlan.artifacts ]
    };
}

async function finalizeRunWithLateAssertions(
    input: ExecuteRunInput,
    events: LateAssertionDelivery
): Promise<RunResult> {
    const result = await withResourceCheckReporting(
        input.context.reporterDelivery,
        input.options.runtimePolicy,
        input.testPlan,
        async function executeObservedResources() {
            return await createRunResultBeforeRunEnd(input);
        }
    );

    input.context.dependencies.asyncLeakMonitor.stop();

    const diagnostics = await reportRunnerErrors(input.context.reporterDelivery, events.take());
    const finalized = await input.options.finalizeResult(appendRunnerErrors(result, diagnostics));
    return appendRunnerErrors(
        finalized,
        await reportRunnerErrors(input.context.reporterDelivery, events.take())
    );
}

function stopGlobalErrorObservation(input: ExecuteRunInput): readonly RunnerError[] {
    const { globalErrorObserver } = input.context.dependencies;
    const observed = globalErrorObserver.takeErrors();
    globalErrorObserver.stop();
    return observed;
}

async function executeRunWithLateAssertions(
    input: ExecuteRunInput,
    events: LateAssertionDelivery
): Promise<RunResult> {
    const finalizedResult = await finalizeRunWithLateAssertions(input, events);
    const runEndErrors = await input.context.reporterDelivery.reportEvent({
        kind: 'run-end',
        result: finalizedResult
    });
    const lateErrors = await reportRunnerErrors(input.context.reporterDelivery, events.take());
    const resultForFinalReporting = appendRunnerErrors(finalizedResult, [ ...runEndErrors, ...lateErrors ]);
    const finalReporterErrors = await input.context.reporterDelivery.reportResult(resultForFinalReporting);
    const finishDiagnostics = await reportRunnerErrors(input.context.reporterDelivery, events.take());
    const disposeErrors = await input.reporterDisposal.disposeOnce();

    return appendRunnerErrors(resultForFinalReporting, [
        ...finalReporterErrors,
        ...finishDiagnostics,
        ...disposeErrors,
        ...stopGlobalErrorObservation(input),
        ...events.seal()
    ]);
}

async function executeRun(input: ExecuteRunInput): Promise<RunResult> {
    return await withAssertionSettlement(async function observeSettlements() {
        return await withLateAssertionDelivery(async function deliverLateAssertions(events) {
            return await executeRunWithLateAssertions(input, events);
        });
    });
}

export type RuntimeExecute = (testPlan: TestPlan, options?: ExecuteOptions) => Promise<RunResult>;

export type Execute = {
    (run: CollectedFamilyRun, options: FamilyExecuteOptions): Promise<RunResult>;
    (testPlan: TestPlan, options?: ExecuteOptions): Promise<RunResult>;
};

export type ExecutionDriver = (
    input: FamilyExecutionRequest | TestPlan,
    options?: ExecuteOptions
) => Promise<RunResult>;

async function executeWithReporterDelivery(
    prepared: PreparedExecution,
    testPlan: TestPlan,
    family: FamilyExecutionRequest | null
): Promise<RunResult> {
    const reporterDelivery = await prepared.dependencies.reporterDispatcher.createDelivery(
        prepared.options.reporters,
        prepared.options.outputRenderer
    );
    const reporterDisposal = createReporterDisposal(reporterDelivery.disposeReporters);
    try {
        return await prepared.globalErrorObserver.runBoundary(async function runObservedExecution() {
            return await executeRun({
                context: { dependencies: prepared.dependencies, reporterDelivery },
                options: prepared.options,
                reporterDisposal,
                testPlan,
                family
            });
        });
    } catch (error: unknown) {
        return await throwWithCleanupErrors(error, reporterDisposal.disposeOnce);
    }
}

function validateAnalysisOptions(options: ExecuteOptions): void {
    const runtimePolicies = [
        options.runtimePolicy,
        options.timeoutPolicy,
        options.processBudgets,
        options.processUsageTracker
    ];
    if (
        runtimePolicies.some(function enabled(value) {
            return value !== null && value !== undefined;
        }) || Object.hasOwn(options, 'propertyRun')
    ) {
        throw new TypeError('Analysis execution does not support runtime execution policy.');
    }
}

function familyExecuteOptions(family: FamilyExecutionRequest, options: ExecuteOptions | undefined): ExecuteOptions {
    if (options === undefined) {
        throw new TypeError('Collected family execution requires execution options.');
    }
    const { features } = family.family;
    if (options.retryPolicy !== null && !features.profileOptions.includes('retries')) {
        throw new TypeError('The selected family does not support retries.');
    }
    if (features.execution === 'analysis') {
        validateAnalysisOptions(options);
    }
    return { ...options, runFacts: { ...options.runFacts, family: family.run.facts } };
}

function isFamilyExecution(input: FamilyExecutionRequest | TestPlan): input is FamilyExecutionRequest {
    return Object.hasOwn(input, 'run');
}

const ordinaryFamilies: ReadonlySet<string | null> = new Set([
    null,
    'microtest',
    'integration',
    'property',
    'benchmark'
]);

function validateRuntimePlan(plan: TestPlan): void {
    for (const testCase of plan.cases) {
        if (testCase.execution.kind !== 'skip' && !ordinaryFamilies.has(testCase.testFamily)) {
            throw new TypeError(`Case requires explicit preparation for family "${testCase.testFamily}".`);
        }
    }
}

async function executeResolvedPlan(
    dependencies: ExecuteDependencies,
    testPlan: TestPlan,
    family: FamilyExecutionRequest | null,
    options: ExecuteOptions | undefined
): Promise<RunResult> {
    return await withPreparedExecution(
        dependencies,
        family === null ? options : familyExecuteOptions(family, options),
        testPlan,
        async function deliver(prepared) {
            return await executeWithReporterDelivery(prepared, testPlan, family);
        }
    );
}

export function createExecute(dependencies: ExecuteDependencies): ExecutionDriver {
    return async function execute(input, options) {
        const { family, testPlan } = isFamilyExecution(input)
            ? { family: input, testPlan: input.run.testPlan }
            : { family: null, testPlan: input };
        if (family === null) {
            validateRuntimePlan(testPlan);
        }

        async function executeResolved(): Promise<RunResult> {
            return await withPreparedBodyPlan(testPlan, family?.signal ?? null, async function executeBodies(resolved) {
                return await executeResolvedPlan(dependencies, resolved, family, options);
            });
        }
        try {
            return await executeResolved();
        } catch (error: unknown) {
            return await rejectFamilyExecution(error, family);
        }
    };
}
