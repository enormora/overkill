import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type TestNode,
    type RunResult,
    createRoot,
    createTestPlan,
    prepareFamily,
    execute
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

export async function withReferenceFamilyProject(use: (directory: string) => Promise<void>): Promise<void> {
    await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-reference-family-'));
    await writeFile(
        join(directory.path, 'bodies.mjs'),
        [
            "export const rows={version:'1',implementation(scope){scope.assert.equal(scope.parameters,42);",
            'return scope.assert.collect();}};',
            "export const throwing={version:'1',implementation(scope){scope.assert.equal(42,42);return undefined;}};",
            "export const work={version:'1',implementation(scope,input){scope.assert.equal(input,42);",
            'return scope.assert.collect();}};',
            "export const sample={version:'1',implementation({value,sample}){sample.assert.equal(value,42);",
            'return sample.assert.collect();}};',
            "export const nested={version:'1',implementation(scope){",
            "scope.assert.equal(typeof scope.forall,'function');",
            'return scope.assert.collect();}};',
            "export const measurement={version:'1',implementation(context){",
            'const measured=context.sample.measure(function operation(){return context.workload.parameters.size;});',
            'return {size:measured.value};}};'
        ]
            .join('\n')
    );
    await use(directory.path);
}
