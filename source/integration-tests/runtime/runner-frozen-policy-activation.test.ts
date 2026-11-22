import { mkdtempDisposable, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';

import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

import { createPlainOutputRenderer } from '../../engine/reporter-output.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { initializeMutationPolicy } from '../../packages/stryker-runner/mutation-policy-process.ts';

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

const assertStaticPolicy = defineCompositeAssertion({
    name: 'static policy',
    async assert(check, cwd: string, staticCoverage: Readonly<Record<string, number>>) {
        const controller = new AbortController();
        const policy = await initializeMutationPolicy({
            sandbox: null,
            cwd,
            settings: {
                freshState: false,
                artifactPersistence: 'off',
                seed: '42',
                configPath: 'overkill.config.mjs',
                paths: [],
                profile: null
            },
            signal: controller.signal
        });
        return check.group([
            check.equal(policy.profile.execution.processModel, 'in-process'),
            check.equal(Object.keys(staticCoverage).length, 0),
            await check.rejects(async function runStaticallyMutatedConfig() {
                await orchestrator.run({
                    kind: 'frozen-policy',
                    policy,
                    invocation: { seed: { value: 1n }, selection: { kind: 'all' } },
                    reporting: { reporters: [], outputRenderer: createPlainOutputRenderer() }
                });
            }, { message: /Frozen policy changed: execution/ }),
            check.equal(staticCoverage['0'], 1)
        ]);
    }
});

function restoreNamespace(namespace: string, previous: unknown): void {
    if (previous === undefined) {
        Reflect.deleteProperty(globalThis, namespace);
    } else {
        Reflect.set(globalThis, namespace, previous);
    }
}

type StaticActivation = {
    readonly namespace: string;
    readonly coverage: Readonly<Record<string, number>>;
    readonly runtime: unknown;
};
function staticActivation(cleanup: TestScope['cleanup']): StaticActivation {
    const namespace = INSTRUMENTER_CONSTANTS.NAMESPACE;
    const previous: unknown = Reflect.get(globalThis, namespace);
    const coverage: Record<string, number> = {};
    const runtime = { activeMutant: '0', mutantCoverage: { static: coverage, perTest: {} } };
    Reflect.set(globalThis, namespace, runtime);
    cleanup(function () {
        restoreNamespace(namespace, previous);
    });
    return { namespace, coverage, runtime };
}
export const testNode = suite('frozen policy with static activation', [
    test('isolated initialization leaves static config coverage for execution', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-static-policy-'));
        const cwd = await realpath(directory.path);
        await createInstrumentedProject(cwd);
        const { namespace, coverage, runtime } = staticActivation(scope.cleanup);
        await scope.assert(assertStaticPolicy, cwd, coverage);
        scope.assert.equal(Reflect.get(globalThis, namespace), runtime);
        return scope.assert.collect();
    })
]);
