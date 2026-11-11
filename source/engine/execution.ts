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
    return { ...result, artifacts: [ ...result.artifacts, ...executedTestPlan.artifacts ] };
}

async function executeRun(input: ExecuteRunInput): Promise<RunResult> {
    const result = await createRunResultBeforeRunEnd(input);

    input.context.dependencies.globalErrorObserver.stop();
    input.context.dependencies.asyncLeakMonitor.stop();

    const finalizedResult = await input.options.finalizeResult(result);
    const runEndErrors = await input.context.reporterDelivery.reportEvent({
        kind: 'run-end',
        result: finalizedResult
    });
    const resultForFinalReporting = appendRunnerErrors(finalizedResult, runEndErrors);
    const finalReporterErrors = await input.context.reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await input.reporterDisposal.disposeOnce();

    return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
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

export function createExecute(dependencies: ExecuteDependencies): ExecutionDriver {
    return async function execute(input, options) {
        const { family, testPlan } = isFamilyExecution(input)
            ? { family: input, testPlan: input.run.testPlan }
            : { family: null, testPlan: input };
        if (family === null) {
            validateRuntimePlan(testPlan);
        }
        async function executeResolved(): Promise<RunResult> {
            const resolvedOptions = family === null ? options : familyExecuteOptions(family, options);
            return await withPreparedExecution(
                dependencies,
                resolvedOptions,
                testPlan,
                async function executePrepared(prepared) {
                    return await executeWithReporterDelivery(prepared, testPlan, family);
                }
            );
        }
        try {
            return await executeResolved();
        } catch (error: unknown) {
            return await rejectFamilyExecution(error, family);
        }
    };
}
