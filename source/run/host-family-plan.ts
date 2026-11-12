import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { executePreparedFamilyWithDriver, type Engine } from '../engine/engine.ts';
import { builtinTestFamily, type BuiltinFamilyId } from '../engine/builtin-test-families.ts';
import {
    createExecute,
    type ExecuteOptions,
    type ExecutionDriver,
    type ExecuteDependencies,
    type RuntimeExecute
} from '../engine/execution.ts';
import type { TestFamily } from '../engine/test-family.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { SupervisedRunCommand } from './supervised-protocol.ts';

const families = new WeakMap<TestPlan, {
    readonly source: TestPlan;
    readonly engine: Engine;
    readonly testFamily: TestFamily<null>;
    readonly projectRoot: string;
}>();

export function registerHostFamilyPlan(
    plan: TestPlan,
    engine: Engine,
    id: BuiltinFamilyId,
    projectRoot: string
): TestPlan {
    families.set(plan, { source: plan, engine, testFamily: builtinTestFamily(id), projectRoot });
    return plan;
}

async function executeHostFamily(
    source: TestPlan,
    selected: TestPlan,
    driver: ExecutionDriver,
    options: ExecuteOptions
): Promise<RunResult> {
    const executionOptions = { ...options, outputRenderer: createPlainOutputRenderer() };
    const family = families.get(source);
    if (family === undefined) {
        return await driver(selected, executionOptions);
    }
    const controller = new AbortController();
    const { signal } = controller;
    await using prepared = await family.engine.prepareFamily({
        testPlan: family.source,
        testFamily: family.testFamily,
        settings: null,
        projectRoot: family.projectRoot,
        signal
    });
    const collected = await prepared.collect({
        workIds: selected.cases.map(function identity(testCase) {
            return testCase.workId;
        }),
        signal
    });
    return await executePreparedFamilyWithDriver(family.engine, collected, { ...executionOptions, signal }, driver);
}

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
            : await executeHostFamily(input.sourcePlan, plan, execute, options);
    };
}
