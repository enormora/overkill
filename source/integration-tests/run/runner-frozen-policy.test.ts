import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { createPlainOutputRenderer } from '../../engine/reporter-output.ts';
import type { Config, ProjectMicrotestProfileConfig } from '../../packages/run/config.entry-point.ts';
import { orchestrator, type FrozenMicrotestPolicy, type FrozenRunCommand } from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { initializeMutationPolicy } from '../../packages/stryker-runner/mutation-policy-process.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const engineModule = new URL(`../../packages/engine/engine.entry-point${extname(import.meta.url)}`, import.meta.url);
const engineUrl = engineModule.href;
type ProcessModel = 'in-process' | 'supervised-process';
type PolicyAssertion = (scope: TestScope, cwd: string, policy: FrozenMicrotestPolicy) => Promise<void>;

function profile(processModel: ProcessModel): ProjectMicrotestProfileConfig {
    return {
        testFamily: 'microtest',
        files: { include: [ 'case.test.mjs' ] },
        execution: { processModel, scheduling: 'concurrent' },
        timeouts: { collectionMilliseconds: 10_000 }
    };
}

async function writePolicy(cwd: string, config: Config): Promise<void> {
    await writeFile(join(cwd, 'policy.mjs'), `export const config = ${JSON.stringify(config)};`);
}

async function createProject(cwd: string, processModel: ProcessModel): Promise<void> {
    await writePolicy(cwd, { profiles: { microtest: profile(processModel) } });
    await writeFile(
        join(cwd, 'overkill.config.mjs'),
        `
import { writeFileSync } from 'node:fs';
import { config } from './policy.mjs';
if (process.argv.includes('--overkill-mutation-policy-resolver')) {
    writeFileSync(new URL('./resolver.pid', import.meta.url), String(process.pid));
}
export { config };
`
    );
    await writeFile(join(cwd, 'case.test.mjs'), 'throw new Error("test imported before revalidation");');
}

async function writePassingCase(cwd: string): Promise<void> {
    await writeFile(
        join(cwd, 'case.test.mjs'),
        `
import { createTestCase } from ${JSON.stringify(engineUrl)};
export const testNode = createTestCase({
    title: 'passes', annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}],
    body(scope) { scope.assert.equal(1 + 1, 2); return scope.assert.collect(); }
});
`
    );
}

function invocation(policy: FrozenMicrotestPolicy): FrozenRunCommand {
    return {
        kind: 'frozen-policy',
        policy,
        invocation: { seed: { value: 17n }, selection: { kind: 'all' } },
        reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
    };
}

async function assertResolverReaped(scope: TestScope, cwd: string): Promise<void> {
    const pid = Number(await readFile(join(cwd, 'resolver.pid'), 'utf8'));
    scope.assert.notEqual(pid, process.pid);
    scope.assert.throws(function probeReapedResolver() {
        process.kill(pid, 0);
    }, { message: /ESRCH/ });
}

async function withPolicy(processModel: ProcessModel, scope: TestScope, assertion: PolicyAssertion): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-frozen-policy-'));
    const cwd = await realpath(directory);
    try {
        await createProject(cwd, processModel);
        const cancellation = new AbortController();
        const policy = await initializeMutationPolicy({
            cwd,
            settings: { configPath: 'overkill.config.mjs', paths: [], profile: null },
            signal: cancellation.signal
        });
        await assertResolverReaped(scope, cwd);
        await assertion(scope, cwd, policy);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}

async function acceptsEffectivePolicy(scope: TestScope, cwd: string, policy: FrozenMicrotestPolicy): Promise<void> {
    await writePolicy(cwd, {
        profiles: {
            microtest: {
                ...profile(policy.profile.execution.processModel),
                execution: { processModel: policy.profile.execution.processModel, scheduling: 'serial' },
                coverage: { outputs: [ 'json' ] }
            },
            browser: { testFamily: 'integration', files: { include: [ 'case.test.mjs' ] } }
        }
    });
    await writePassingCase(cwd);
    const result = await orchestrator.run(invocation(policy));
    scope.assert.equal(result.summary.passed, 1);
    scope.assert.deepEqual(result.runnerErrors, []);
}

async function rejectsDrift(scope: TestScope, policy: FrozenMicrotestPolicy, domain: string): Promise<void> {
    if (policy.profile.execution.processModel === 'in-process') {
        await scope.assert.rejects(async function runChangedPolicy() {
            await orchestrator.run(invocation(policy));
        }, { message: new RegExp(`Frozen policy changed: .*${domain}`) });
        return;
    }
    const result = await orchestrator.run(invocation(policy));
    scope.assert.equal(result.summary.passed, 0);
    scope.assert.true(result.runnerErrors.some(function policyDrift(error) {
        return error.message.includes('Frozen policy changed:') && error.message.includes(domain);
    }));
}

const changes = [
    {
        domain: 'discovery',
        config: { files: { include: [ '*.test.mjs' ] } },
        loader: { sourceMaps: false, stripMode: 'strip-only' }
    },
    {
        domain: 'execution',
        config: { timeouts: { collectionMilliseconds: 11_000 } },
        loader: { sourceMaps: false, stripMode: 'strip-only' }
    },
    {
        domain: 'resources',
        config: { resourceUsage: { measure: true } },
        loader: { sourceMaps: false, stripMode: 'strip-only' }
    },
    { domain: 'loader', config: {}, loader: { sourceMaps: true, stripMode: 'strip-only' } }
] as const;

export const testNode = createSuite({
    title: 'frozen campaign policy',
    ...metadata,
    children: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processModelTests(processModel) {
        return [
            createTestCase({
                title: `${processModel} accepts effective policy and reaps its resolver`,
                ...metadata,
                async body(scope: TestScope) {
                    await withPolicy(processModel, scope, acceptsEffectivePolicy);
                    return scope.assert.collect();
                }
            }),
            ...changes.map(function changedPolicyTest(change) {
                return createTestCase({
                    title: `${processModel} rejects changed ${change.domain} before test imports`,
                    ...metadata,
                    async body(scope: TestScope) {
                        await withPolicy(
                            processModel,
                            scope,
                            async function rejectChangedPolicy(innerScope, cwd, policy) {
                                await writePolicy(cwd, {
                                    loader: change.loader,
                                    profiles: { microtest: { ...profile(processModel), ...change.config } }
                                });
                                await rejectsDrift(innerScope, policy, change.domain);
                            }
                        );
                        return scope.assert.collect();
                    }
                });
            })
        ];
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
