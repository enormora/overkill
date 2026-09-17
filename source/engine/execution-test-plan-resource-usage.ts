import type { NormalizedExecuteOptions } from './execution-options.ts';
import {
    executeResourceTrackedCases,
    type ResourceTrackedCaseResult
} from './execution-resource-tracked-cases.ts';
import { createExecutionSupervision } from './execution-supervision.ts';
import {
    executeTestPlanCasesWithMode,
    type ExecutedTestPlan,
    type ExecutionCaseDependencies,
    type ExecuteTestPlanCasesInput
} from './execution-test-plan-cases.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { TestPlan } from './test-plan.ts';

export async function executeTestPlanCasesAndMeasureResourceUsage(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionCaseDependencies,
    reporterDelivery: ReporterDelivery
): Promise<ResourceTrackedCaseResult<ExecutedTestPlan>> {
    const supervision = createExecutionSupervision();
    const input: ExecuteTestPlanCasesInput = {
        context: { dependencies, reporterDelivery },
        options,
        supervision,
        testPlan
    };

    return await executeResourceTrackedCases(input, executeTestPlanCasesWithMode);
}
