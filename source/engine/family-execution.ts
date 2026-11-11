import { completeFamilyResults } from './family-evidence-state.ts';
import { executeFamilyAnalysis } from './family-evidence.ts';
import type { FamilyExecutionRequest } from './family-run.ts';
import type { NormalizedExecuteOptions } from './execution-options.ts';
import type { PreparedExecution } from './execution-preparation.ts';
import { executeTestPlanCasesAndMeasureProcessUsage } from './execution-test-plan-process-usage.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import type { RunArtifact } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';

type ExecutionWorkInput = {
    readonly family: FamilyExecutionRequest | null;
    readonly testPlan: TestPlan;
    readonly options: NormalizedExecuteOptions;
    readonly context: {
        readonly dependencies: PreparedExecution['dependencies'];
        readonly reporterDelivery: ReporterDelivery;
    };
};

type RuntimeWork = Awaited<ReturnType<typeof executeTestPlanCasesAndMeasureProcessUsage>>;
type ExecutedWork = RuntimeWork & {
    readonly executedTestPlan: RuntimeWork['executedTestPlan'] & { readonly artifacts: readonly RunArtifact[]; };
};

async function executeRuntimeWork(input: ExecutionWorkInput): Promise<ExecutedWork> {
    const { family, testPlan, options, context: { dependencies, reporterDelivery } } = input;
    const runtime = await executeTestPlanCasesAndMeasureProcessUsage(
        testPlan,
        options,
        { dependencies, reporterDelivery, signal: family?.signal ?? null }
    );
    return {
        ...runtime,
        executedTestPlan: {
            ...runtime.executedTestPlan,
            perTest: family === null ? runtime.executedTestPlan.perTest : completeFamilyResults(
                testPlan,
                runtime.executedTestPlan.perTest
            ),
            artifacts: []
        }
    };
}

async function executeUnobservedWork(input: ExecutionWorkInput): Promise<ExecutedWork> {
    const { family, testPlan, context: { dependencies, reporterDelivery } } = input;
    if (family?.family.features.execution !== 'analysis') {
        return await executeRuntimeWork(input);
    }
    const analysisStarted = Number(dependencies.wallClock.currentMonotonicMicroseconds);
    const evidence = await executeFamilyAnalysis(
        testPlan,
        reporterDelivery,
        family.collection?.kind === 'analysis' ? family.collection.execute : null,
        family.signal
    );
    return {
        executedTestPlan: {
            ...evidence,
            testExecutionWallTimeMicroseconds: Number(dependencies.wallClock.currentMonotonicMicroseconds) -
                analysisStarted
        },
        processUsage: null
    };
}

export async function executeFamilyWork(input: ExecutionWorkInput): Promise<ExecutedWork> {
    async function execute(): Promise<ExecutedWork> {
        return await executeUnobservedWork(input);
    }
    return input.family === null ? await execute() : await input.family.lifetime.observe(execute);
}
