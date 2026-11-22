import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { createTestFacade, suite } from '@overkill-dev/test';
import { defineResource } from '@overkill-dev/test/resources';

import { createPlainOutputRenderer, type RunResult } from '../../packages/engine/engine.entry-point.ts';
import type { Config, ProjectMicrotestProfileConfig } from '../../packages/run/config.entry-point.ts';
import { orchestrator, type FrozenMicrotestPolicy, type FrozenRunCommand } from '../../packages/run/run.entry-point.ts';
import { initializeMutationPolicy } from '../../packages/stryker-runner/mutation-policy-process.ts';

const engineModule = new URL(`../../packages/engine/engine.entry-point${extname(import.meta.url)}`, import.meta.url);
const engineUrl = engineModule.href;
type ProcessModel = 'in-process' | 'supervised-process';

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

const assertResolverReaped = defineCompositeAssertion({
    name: 'resolver reaped',
    async assert(check, cwd: string) {
        const pid = Number(await readFile(join(cwd, 'resolver.pid'), 'utf8'));
        return check.group([
            check.notEqual(pid, process.pid),
            check.throws(function probeReapedResolver() {
                process.kill(pid, 0);
            }, { message: /ESRCH/ })
        ]);
    }
});

const frozenProject = defineResource({
    name: 'frozen mutation policy project',
    scope: 'per-case',
    requirements: [],
    async acquire(context) {
        const directory = await mkdtemp(join(resolve('target'), 'frozen-policy-'));
        try {
            const cwd = await realpath(directory);
            return {
                cwd,
                async initialize(processModel: ProcessModel) {
                    await createProject(cwd, processModel);
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
                        signal: context.signal
                    });
                    return { cwd, policy };
                }
            };
        } catch (error) {
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    },
    async dispose(project) {
        await rm(project.cwd, { recursive: true, force: true });
    }
});
const { table } = createTestFacade({ resources: { project: frozenProject } });

async function runEffectivePolicy(cwd: string, policy: FrozenMicrotestPolicy): Promise<RunResult> {
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
    return await orchestrator.run(invocation(policy));
}
const acceptsEffectivePolicy = defineCompositeAssertion({
    name: 'accepts effective policy',
    assert(check, result: RunResult) {
        return check.group([ check.equal(result.summary.passed, 1), check.deepEqual(result.runnerErrors, []) ]);
    }
});
const rejectsDrift = defineCompositeAssertion({
    name: 'frozen policy drift',
    assert(check, result: RunResult, domain: string) {
        return check.group([
            check.equal(result.summary.passed, 0),
            check.true(result.runnerErrors.some(function policyDrift(error) {
                return error.message.includes('Frozen policy changed:') && error.message.includes(domain);
            }))
        ]);
    }
});

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
        domain: 'processUsage',
        config: { processUsage: { measure: true } },
        loader: { sourceMaps: false, stripMode: 'strip-only' }
    },
    { domain: 'loader', config: {}, loader: { sourceMaps: true, stripMode: 'strip-only' } }
] as const;

export const testNode = suite(
    'frozen campaign policy',
    [
        table({
            title: 'accepts effective policy and reaps its resolver',
            cases: [ { processModel: 'in-process' }, { processModel: 'supervised-process' } ] as const,
            caseTitle({ processModel }) {
                return processModel;
            },
            async test(scope) {
                const { cwd, policy } = await scope.resources.project.initialize(scope.parameters.processModel);
                await scope.assert(assertResolverReaped, cwd);
                scope.assert(acceptsEffectivePolicy, await runEffectivePolicy(cwd, policy));
                return scope.assert.collect();
            }
        }),
        table({
            title: 'rejects policy changes before importing tests',
            cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function processModelTests(processModel) {
                return changes.map(function changedPolicyTest(change) {
                    return { processModel, change };
                });
            }),
            caseTitle({ processModel, change }) {
                return `${processModel}, ${change.domain}`;
            },
            async test(scope) {
                const { processModel, change } = scope.parameters;

                const { cwd, policy } = await scope.resources.project.initialize(scope.parameters.processModel);
                await scope.assert(assertResolverReaped, cwd);
                await writePolicy(cwd, {
                    loader: change.loader,
                    profiles: { microtest: { ...profile(processModel), ...change.config } }
                });
                if (processModel === 'in-process') {
                    await scope.assert.rejects(async function runChangedPolicy() {
                        await orchestrator.run(invocation(policy));
                    }, { message: new RegExp(`Frozen policy changed: .*${change.domain}`) });
                } else {
                    const result = await orchestrator.run(invocation(policy));
                    scope.assert(rejectsDrift, result, change.domain);
                }
                return scope.assert.collect();
            }
        })
    ]
);
