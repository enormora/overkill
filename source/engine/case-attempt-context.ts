import type { AsyncLeakDependencies } from './execution-async-leak-policy.ts';
import type { ExecutionSupervision, ExecutionSupervisionDependencies } from './execution-supervision.ts';
import type { NormalizedExecuteOptions } from './execution-options.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { TestPlanCase } from './test-plan.ts';

export type ExecutionCaseDependencies = AsyncLeakDependencies & ExecutionSupervisionDependencies;
export type CaseReportingContext = {
    readonly dependencies: ExecutionCaseDependencies;
    readonly reporterDelivery: Pick<ReporterDelivery, 'reportEvent'>;
};
export type ExecuteCaseInput = {
    readonly attempt: number;
    readonly context: CaseReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly supervision: ExecutionSupervision;
    readonly testCase: TestPlanCase;
};
