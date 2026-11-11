import { familyRunnerError } from './family-completion.ts';
import type { NormalizedExecuteOptions } from './execution-options.ts';
import {
    executeCasesAndMeasureProcessUsage,
    type ProcessUsageCaseResult
} from './execution-process-tracked-cases.ts';
import { createExecutionSupervision } from './execution-supervision.ts';
import {
    executeTestPlanCasesWithMode,
    type ExecutedTestPlan,
    type ExecuteTestPlanCasesInput
} from './execution-test-plan-cases.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { TestPlan } from './test-plan.ts';
import type { ExecutionCaseDependencies } from './case-attempt-context.ts';

type RuntimeExecutionContext = {
    readonly dependencies: ExecutionCaseDependencies;
    readonly reporterDelivery: ReporterDelivery;
    readonly signal: Readonly<AbortSignal> | null;
};

export async function executeTestPlanCasesAndMeasureProcessUsage(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    context: RuntimeExecutionContext
): Promise<ProcessUsageCaseResult<ExecutedTestPlan>> {
    const { dependencies, reporterDelivery, signal } = context;
    const supervision = createExecutionSupervision();
    const input: ExecuteTestPlanCasesInput = {
        context: { dependencies, reporterDelivery },
        options,
        supervision,
        testPlan
    };

    function cancel(): void {
        supervision.cancel();
        supervision.recordRunnerError(familyRunnerError(signal?.reason));
    }
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted === true) {
        cancel();
    }
    try {
        return await executeCasesAndMeasureProcessUsage(input, executeTestPlanCasesWithMode);
    } finally {
        signal?.removeEventListener('abort', cancel);
    }
}
