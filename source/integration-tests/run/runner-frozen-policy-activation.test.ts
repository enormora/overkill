import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';
import { createSuite, createTestCase, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createPlainOutputRenderer } from '../../engine/reporter-output.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { initializeMutationPolicy } from '../../packages/stryker-runner/mutation-policy-process.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

async function createInstrumentedProject(cwd: string): Promise<void> {
    await writeFile(join(cwd, 'case.test.mjs'), 'throw new Error("collected a test before policy validation");');
    await writeFile(
        join(cwd, 'instrumented-policy.mjs'),
        `
const namespace = ${JSON.stringify(INSTRUMENTER_CONSTANTS.NAMESPACE)};
const runtime = globalThis[namespace] ??= {};
const coverage = runtime.mutantCoverage ??= { static: {}, perTest: {} };
coverage.static['0'] = (coverage.static['0'] ?? 0) + 1;
export const processModel = runtime.activeMutant === '0' ? 'supervised-process' : 'in-process';
`
    );
    await writeFile(
        join(cwd, 'overkill.config.mjs'),
        `
import { processModel } from './instrumented-policy.mjs';
export const config = { profiles: { microtest: {
    testFamily: 'microtest', files: { include: ['case.test.mjs'] }, execution: { processModel }
} } };
`
    );
}

async function assertStaticPolicy(
    scope: TestScope,
    cwd: string,
    staticCoverage: Readonly<Record<string, number>>
): Promise<void> {
    const controller = new AbortController();
    const policy = await initializeMutationPolicy({
        sandbox: null,
        cwd,
        settings: { configPath: 'overkill.config.mjs', paths: [], profile: null },
        signal: controller.signal
    });
    scope.assert.equal(policy.profile.execution.processModel, 'in-process');
    scope.assert.equal(Object.keys(staticCoverage).length, 0);
    await scope.assert.rejects(async function runStaticallyMutatedConfig() {
        await orchestrator.run({
            kind: 'frozen-policy',
            policy,
            invocation: { seed: { value: 1n }, selection: { kind: 'all' } },
            reporting: { reporters: [], outputRenderer: createPlainOutputRenderer() }
        });
    }, { message: /Frozen policy changed: execution/ });
    scope.assert.equal(staticCoverage['0'], 1);
}

function restoreNamespace(namespace: string, previous: unknown): void {
    if (previous === undefined) {
        Reflect.deleteProperty(globalThis, namespace);
    } else {
        Reflect.set(globalThis, namespace, previous);
    }
}

async function rejectStaticPolicy(scope: TestScope, cwd: string): Promise<void> {
    const staticCoverage: Record<string, number> = {};
    const namespace = INSTRUMENTER_CONSTANTS.NAMESPACE;
    const previous: unknown = Reflect.get(globalThis, namespace);
    const runtime = { activeMutant: '0', mutantCoverage: { static: staticCoverage, perTest: {} } };
    Reflect.set(globalThis, namespace, runtime);
    try {
        await assertStaticPolicy(scope, cwd, staticCoverage);
        scope.assert.equal(Reflect.get(globalThis, namespace), runtime);
    } finally {
        restoreNamespace(namespace, previous);
    }
}

export const testNode = createSuite({
    title: 'frozen policy with static activation',
    ...metadata,
    children: [ createTestCase({
        title: 'isolated initialization leaves static config coverage for execution',
        ...metadata,
        async body(scope: TestScope) {
            const directory = await mkdtemp(join(tmpdir(), 'overkill-static-policy-'));
            const cwd = await realpath(directory);
            try {
                await createInstrumentedProject(cwd);
                await rejectStaticPolicy(scope, cwd);
                return scope.assert.collect();
            } finally {
                await rm(cwd, { recursive: true, force: true });
            }
        }
    }) ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
