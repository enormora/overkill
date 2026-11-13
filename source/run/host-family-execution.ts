import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { createExecute, type ExecuteDependencies, type RuntimeExecute } from '../engine/execution.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { SupervisedRunCommand } from './supervised-protocol.ts';
import { executeHostFamily } from './host-family-plan.ts';

export type HostExecutionInput = {
    readonly command: Pick<
        SupervisedRunCommand,
        'benchmarkGarbageCollection' | 'benchmarkNormalization' | 'testFamily'
    >;
    readonly processModel: 'direct' | 'hosted-worker' | 'supervised-process';
    readonly sourcePlan: TestPlan;
    readonly reporterDispatcher: ExecuteDependencies['reporterDispatcher'];
    readonly wallClock: ExecuteDependencies['wallClock'];
};

function readActiveResourceTypes(): readonly string[] {
    return process.getActiveResourcesInfo();
}

async function hostBenchmarkEnvironment(
    input: HostExecutionInput
): Promise<ExecuteDependencies['benchmarkEnvironment']> {
    if (input.command.testFamily !== 'benchmark') {
        return null;
    }
    const { createBenchmarkExecutionEnvironment } = await import('./benchmark-execution-environment.ts');
    return createBenchmarkExecutionEnvironment(
        input.command.benchmarkGarbageCollection,
        input.processModel,
        input.command.benchmarkNormalization
    );
}

export async function createHostExecutionDriver(input: HostExecutionInput): Promise<RuntimeExecute> {
    const benchmarkEnvironment = await hostBenchmarkEnvironment(input);
    const execute = createExecute({
        benchmarkEnvironment,
        asyncLeakDiagnostics: 'enabled',
        readActiveResourceTypes,
        reporterDispatcher: input.reporterDispatcher,
        wallClock: input.wallClock
    });
    return async function executeSelectedFamily(plan, options) {
        return options === undefined
            ? await execute(plan)
            : await executeHostFamily(input.sourcePlan, plan, execute, {
                ...options,
                outputRenderer: createPlainOutputRenderer()
            });
    };
}
