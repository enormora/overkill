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
import type { ExecutionCaseDependencies } from './case-attempt-execution.ts';

export async function executeTestPlanCasesAndMeasureProcessUsage(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionCaseDependencies,
    reporterDelivery: ReporterDelivery
): Promise<ProcessUsageCaseResult<ExecutedTestPlan>> {
    const supervision = createExecutionSupervision();
    const input: ExecuteTestPlanCasesInput = {
        context: { dependencies, reporterDelivery },
        options,
        supervision,
        testPlan
    };

    return await executeCasesAndMeasureProcessUsage(input, executeTestPlanCasesWithMode);
}
