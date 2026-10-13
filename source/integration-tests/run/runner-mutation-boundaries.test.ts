import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createPlainOutputRenderer, type TestScope } from '../../packages/engine/engine.entry-point.ts';
import { suite, test } from '../../packages/test/test.entry-point.ts';
import {
    ConfigError,
    orchestrator,
    type FrozenMicrotestPolicy,
    type FrozenRunCommand
} from '../../packages/run/run.entry-point.ts';
import { createMutationSandbox } from '../../packages/stryker-runner/mutation-sandbox.ts';
import { initializeMutationPolicy } from '../../packages/stryker-runner/mutation-policy-process.ts';
import { createMutationExecution, type MutationExecution } from '../../packages/stryker-runner/mutation-execution.ts';
import { runIfMain } from '../../test-support/run-if-main.ts';

type ProjectDirectories = { readonly originalRoot: string; readonly cwd: string; };
type ProcessModel = 'in-process' | 'supervised-process';
const engineModule = new URL(`../../packages/engine/engine.entry-point${extname(import.meta.url)}`, import.meta.url);
const engineUrl = engineModule.href;

async function withProject(operation: (paths: ProjectDirectories) => Promise<void>): Promise<void> {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'overkill-mutation-boundary-')));
    const originalRoot = join(directory, 'original');
    const cwd = join(originalRoot, '.stryker-tmp', 'sandbox');
    try {
        await mkdir(cwd, { recursive: true });
        await writeFile(join(originalRoot, 'policy.mjs'), 'throw new Error("original configuration evaluated");');
        await writeFile(join(originalRoot, 'case.test.mjs'), 'throw new Error("original test evaluated");');
        await writeFile(
            join(originalRoot, 'subject.mjs'),
            `import {writeFile} from "node:fs/promises";
await writeFile(new URL("original-evaluated",import.meta.url),"evaluated");
throw new Error("original subject evaluated");`
        );
        await operation({ originalRoot, cwd });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

async function policyFor(paths: ProjectDirectories, targets: readonly string[]): Promise<FrozenMicrotestPolicy> {
    const sandbox = await createMutationSandbox({
        ...paths,
        fileDescriptions: Object.fromEntries(
            [ 'policy.mjs', 'case.test.mjs', 'subject.mjs' ].map(function describeFile(file) {
                return [ join(paths.originalRoot, file), { mutate: targets.includes(file) } ];
            })
        )
    });
    const controller = new AbortController();
    return await initializeMutationPolicy({
        cwd: paths.cwd,
        sandbox,
        settings: {
            freshState: false,
            seed: '42',
            configPath: join(paths.originalRoot, 'policy.mjs'),
            paths: [],
            profile: 'microtest'
        },
        signal: controller.signal
    });
}

async function writePolicy(cwd: string, processModel: ProcessModel): Promise<void> {
    await writeFile(
        join(cwd, 'policy.mjs'),
        `export const config = ${
            JSON.stringify({
                profiles: {
                    microtest: {
                        testFamily: 'microtest',
                        files: { include: [ 'case.test.mjs' ] },
                        execution: { processModel },
                        timeouts: { collectionMilliseconds: 10_000 }
                    }
                }
            })
        };`
    );
    await writeFile(join(cwd, 'case.test.mjs'), 'throw new Error("test imported during initialization");');
    await writeFile(join(cwd, 'subject.mjs'), 'export const value = 2;');
}

function invocation(policy: FrozenMicrotestPolicy): FrozenRunCommand {
    return {
        kind: 'frozen-policy',
        policy,
        reporting: { reporters: [], outputRenderer: createPlainOutputRenderer() },
        invocation: { seed: { value: 7n }, selection: { kind: 'all' } }
    } as const;
}

async function assertRejectedImport(
    scope: TestScope,
    policy: FrozenMicrotestPolicy,
    diagnostic: string
): Promise<void> {
    if (policy.profile.execution.processModel === 'in-process' && diagnostic === 'Frozen policy revalidation failed') {
        await scope.assert.rejects(async function runEscapingImport() {
            await orchestrator.run(invocation(policy));
        }, { message: new RegExp(diagnostic) });
        return;
    }
    const result = await orchestrator.run(invocation(policy));
    scope.assert.equal(result.summary.passed, 0);
    scope.assert.equal(result.summary.planned, 0);
    scope.assert.true(result.runnerErrors.some(function boundaryFailure(error) {
        return error.message.includes(diagnostic);
    }));
    if (policy.profile.execution.processModel === 'in-process') {
        scope.assert.true(result.runnerErrors.some(function originalNeverEvaluated(error) {
            return error.cause instanceof Error && error.cause.message.includes('Module import escapes');
        }));
    }
}

async function assertFreshImports(
    scope: TestScope,
    paths: ProjectDirectories,
    execution: MutationExecution
): Promise<void> {
    await writeFile(
        join(paths.cwd, 'case.test.mjs'),
        `
import { createTestCase } from ${JSON.stringify(engineUrl)};
import { value } from './subject.mjs';
export const testNode = createTestCase({
    annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}], title: 'sandboxed',
    body(scope) { scope.assert.equal(value, 2); return scope.assert.collect(); }
});
`
    );
    const result = await execution.run({ kind: 'all' });
    scope.assert.equal(result.status, 'passed');
    const original = JSON.stringify(join(paths.originalRoot, 'subject.mjs'));
    await writeFile(join(paths.cwd, 'case.test.mjs'), `import ${original};`);
    await scope.assert.rejects(async function rejectFreshTestEscape() {
        await execution.run({ kind: 'all' });
    }, { cause: { message: /Module import escapes/u } });
}

export const testNode = suite('mutation boundaries through the public runner', [
    test('fresh hosts enforce frozen configuration and sandbox import boundaries', async function (scope) {
        await withProject(async function assertFreshBoundaries(paths) {
            await writePolicy(paths.cwd, 'in-process');
            const policy = await policyFor(paths, [ 'subject.mjs' ]);
            const execution = createMutationExecution({ policy, seed: { value: 42n }, freshState: true });
            scope.cleanup(async function disposeFreshExecution() {
                await execution.dispose();
            });
            await assertFreshImports(scope, paths, execution);
            const original = JSON.stringify(join(paths.originalRoot, 'subject.mjs'));
            await writeFile(join(paths.cwd, 'policy.mjs'), `import ${original}; export const config = {};`);
            await scope.assert.rejects(async function rejectFreshConfigEscape() {
                await execution.run({ kind: 'all' });
            }, { message: /Frozen policy revalidation failed/u });
            const files = await readdir(paths.originalRoot);
            scope.assert.false(files.includes('original-evaluated'));
        });
        return scope.assert.collect();
    }),
    test('rejects protected targets before importing tests and accepts production targets', async function (scope) {
        await withProject(async function assertProtectedTargets(paths) {
            await writePolicy(paths.cwd, 'in-process');
            for (const file of [ 'policy.mjs', 'case.test.mjs' ]) {
                await scope.assert.rejects(async function initializeProtectedTarget() {
                    await policyFor(paths, [ file ]);
                }, { type: ConfigError, message: /Exclude .* from Stryker mutate/ });
            }
            const policy = await policyFor(paths, [ 'subject.mjs' ]);
            scope.assert.equal(policy.projectRoot, paths.cwd);
            scope.assert.deepEqual(
                policy.files.map(function origin(file) {
                    return file.file;
                }),
                [ 'case.test.mjs' ]
            );
            scope.assert.equal(
                policy.source.kind === 'config-file' ? policy.source.resolvedPath : null,
                join(paths.cwd, 'policy.mjs')
            );
        });
        return scope.assert.collect();
    }),
    test('preserves relative file identities across sandbox names and replacement policies', async function (scope) {
        await withProject(async function assertReplacementIdentity(paths) {
            await writePolicy(paths.cwd, 'in-process');
            const policy = await policyFor(paths, [ 'subject.mjs' ]);
            const other = join(paths.originalRoot, '.stryker-tmp', 'replacement');
            await mkdir(other);
            await writePolicy(other, 'in-process');
            const replacement = await policyFor({ ...paths, cwd: other }, [ 'subject.mjs' ]);
            scope.assert.deepEqual(
                replacement.files.map(function origin(file) {
                    return file.file;
                }),
                policy.files.map(function origin(file) {
                    return file.file;
                })
            );
            scope.assert.notEqual(replacement.files[0].href, policy.files[0].href);
        });
        return scope.assert.collect();
    }),
    test('rejects original config dependencies, symlinks, and missing sandbox copies', async function (scope) {
        await withProject(async function assertConfigurationEscapes(paths) {
            await writePolicy(paths.cwd, 'in-process');
            const original = join(paths.originalRoot, 'subject.mjs');
            for (const dependency of [ original, './linked.mjs' ]) {
                if (dependency === './linked.mjs') {
                    await symlink(original, join(paths.cwd, 'linked.mjs'));
                }
                await writeFile(
                    join(paths.cwd, 'policy.mjs'),
                    `import ${JSON.stringify(dependency)}; export const config = {};`
                );
                await scope.assert.rejects(async function loadEscapingConfiguration() {
                    await policyFor(paths, []);
                }, {
                    type: ConfigError,
                    message: /Failed to load config file/,
                    cause: { message: /Module import escapes/ }
                });
            }
            await rm(join(paths.cwd, 'policy.mjs'));
            await scope.assert.rejects(async function loadMissingCopy() {
                await policyFor(paths, []);
            }, { type: ConfigError, message: /Failed to load config file/ });
        });
        return scope.assert.collect();
    }),
    ...([ 'in-process', 'supervised-process' ] as const).flatMap(function processModelTests(processModel) {
        return [
            test(`${processModel} executes sandbox copies through the frozen public runner`, async function (scope) {
                await withProject(async function assertSandboxExecution(paths) {
                    await writePolicy(paths.cwd, processModel);
                    const policy = await policyFor(paths, [ 'subject.mjs' ]);
                    await writeFile(
                        join(paths.cwd, 'case.test.mjs'),
                        `
import { createTestCase } from ${JSON.stringify(engineUrl)};
import { value } from './subject.mjs';
export const testNode = createTestCase({title:'sandbox case',annotations:{},controls:{},
definitionLocations:[{kind:'unknown'}],body(scope){scope.assert.equal(value,2);return scope.assert.collect();}});
`
                    );
                    const result = await orchestrator.run(invocation(policy));
                    scope.assert.equal(result.summary.passed, 1);
                    scope.assert.deepEqual(result.runnerErrors, []);
                    scope.assert.equal(result.perTest[0]?.id.file, 'case.test.mjs');
                });
                return scope.assert.collect();
            }),
            ...[ 'policy.mjs', 'case.test.mjs' ].map(function escapingModule(file) {
                return test(`${processModel} rejects original dependencies in ${file}`, async function (scope) {
                    await withProject(async function assertEscapingDependency(paths) {
                        await writePolicy(paths.cwd, processModel);
                        const policy = await policyFor(paths, []);
                        await writeFile(
                            join(paths.cwd, file),
                            `import ${JSON.stringify(join(paths.originalRoot, 'subject.mjs'))};`
                        );
                        await assertRejectedImport(
                            scope,
                            policy,
                            file === 'policy.mjs' ? 'Frozen policy revalidation failed' : 'Failed to load test module'
                        );
                        const originalFiles = await readdir(paths.originalRoot);
                        scope.assert.false(originalFiles.includes('original-evaluated'));
                    });
                    return scope.assert.collect();
                });
            })
        ];
    })
]);

await runIfMain(import.meta, testNode, {});
