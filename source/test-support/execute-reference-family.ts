import {
    createRoot,
    createTestPlan,
    prepareFamily,
    execute,
    type TestNode,
    type RunResult
} from '../packages/engine/engine.entry-point.ts';
import { builtinTestFamily, type BuiltinFamilyId } from '../engine/builtin-test-families.ts';
import { defaultPropertyPolicy } from '../engine/property-policy.ts';

export async function executeReferenceFamily(
    directory: string,
    family: BuiltinFamilyId,
    children: readonly TestNode[]
): Promise<RunResult> {
    const controller = new AbortController();
    const root = createRoot({ annotations: {}, controls: {}, title: 'reference family', children });
    const testPlan = createTestPlan(root, {
        runtimeMatrices: true,
        benchmarkCalibration: false,
        property: family === 'property' || family === 'integration'
            ? { testFamily: family, policy: defaultPropertyPolicy, timeoutMilliseconds: 10_000 }
            : null
    });
    await using prepared = await prepareFamily({
        testPlan,
        testFamily: builtinTestFamily(family),
        settings: null,
        projectRoot: directory,
        signal: controller.signal
    });
    const collected = await prepared.collect({
        workIds: testPlan.cases.map(function work(testCase) {
            return testCase.workId;
        }),
        signal: controller.signal
    });
    return await execute(collected, {
        signal: controller.signal,
        debug: { mode: 'off' },
        execution: { mode: 'serial-in-process' },
        reporters: [],
        retryPolicy: null,
        runFacts: {},
        startedAt: '2026-11-15T00:00:00.000Z'
    });
}
