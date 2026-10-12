import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { suite, test } from '../test/test.entry-point.ts';
import { ConfigError } from '../run/config.entry-point.ts';
import {
    assertExcludedMutationFiles,
    assertExcludedAdapter,
    createMutationSandbox,
    sandboxRunnerOptions
} from './mutation-sandbox.ts';

type ProjectDirectories = {
    readonly originalRoot: string;
    readonly cwd: string;
};

async function withSandbox(operation: (paths: ProjectDirectories) => Promise<void>): Promise<void> {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'overkill-sandbox-origins-')));
    const originalRoot = join(directory, 'original');
    const cwd = join(directory, 'sandbox');
    try {
        await mkdir(originalRoot);
        await mkdir(cwd);
        await operation({ originalRoot, cwd });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

export const testNode = suite('mutation sandbox origins', [
    test('rejects the executing adapter directory as a mutation target', async function (scope) {
        const originalRoot = dirname(dirname(import.meta.dirname));
        const adapterPath = join(import.meta.dirname, 'overkill-test-runner.ts');
        const sandbox = await createMutationSandbox({
            originalRoot,
            cwd: originalRoot,
            fileDescriptions: {
                [adapterPath]: { mutate: true }
            }
        });
        await scope.assert.rejects(async function rejectAdapterTarget() {
            await assertExcludedAdapter(sandbox);
        }, { type: ConfigError, message: /Exclude adapter code from Stryker mutate/ });
        scope.assert.equal(sandbox.files[0]?.file, relative(originalRoot, adapterPath).replaceAll('\\', '/'));
        return scope.assert.collect();
    }),
    test('rebases absolute original paths and file URLs without reading original files', async function (scope) {
        await withSandbox(async function assertRebasedPaths(paths) {
            const file = join(paths.originalRoot, 'case.test.mjs');
            const sandbox = await createMutationSandbox({ ...paths, fileDescriptions: { [file]: { mutate: false } } });
            scope.assert.deepEqual(sandbox.files, [ { file: 'case.test.mjs', mutationTarget: false } ]);
            const settings = sandboxRunnerOptions(sandbox, {
                configPath: pathToFileURL(join(paths.originalRoot, 'policy.mjs')).href,
                paths: [ file, 'nested', paths.cwd ],
                profile: 'unit'
            });
            scope.assert.deepEqual(settings, {
                configPath: join(paths.cwd, 'policy.mjs'),
                paths: [ join(paths.cwd, 'case.test.mjs'), join(paths.cwd, 'nested'), paths.cwd ],
                profile: 'unit'
            });
            scope.assert.throws(function rejectSiblingPrefix() {
                sandboxRunnerOptions(sandbox, {
                    configPath: null,
                    paths: [ `${paths.originalRoot}-other/case.mjs` ],
                    profile: null
                });
            }, { type: ConfigError, message: /escapes the Stryker sandbox/ });
            scope.assert.throws(function rejectParentTraversal() {
                sandboxRunnerOptions(sandbox, { configPath: '../original/policy.mjs', paths: [], profile: null });
            }, { type: ConfigError, message: /escapes the Stryker sandbox/ });
        });
        return scope.assert.collect();
    }),
    test(
        'rejects protected targets for booleans and mutation ranges while accepting exclusions',
        async function (scope) {
            await withSandbox(async function assertTargetRoles(paths) {
                const sandbox = await createMutationSandbox({
                    ...paths,
                    fileDescriptions: {
                        [join(paths.originalRoot, 'policy.mjs')]: { mutate: true },
                        [join(paths.originalRoot, 'case.test.mjs')]: {
                            mutate: [
                                { start: { line: 0, column: 0 }, end: { line: 1, column: 0 } }
                            ]
                        },
                        [join(paths.originalRoot, 'excluded.test.mjs')]: { mutate: false },
                        [join(paths.originalRoot, 'subject.mjs')]: { mutate: true }
                    }
                });
                for (
                    const [ file, role ] of [ [ 'policy.mjs', 'configuration' ], [
                        'case.test.mjs',
                        'test definitions'
                    ] ] as const
                ) {
                    await scope.assert.rejects(async function rejectProtectedFile() {
                        await assertExcludedMutationFiles(sandbox, [ join(paths.cwd, file) ], role);
                    }, { type: ConfigError, message: new RegExp(`Exclude ${role} from Stryker mutate`) });
                }
                await assertExcludedMutationFiles(
                    sandbox,
                    [ join(paths.cwd, 'excluded.test.mjs') ],
                    'test definitions'
                );
                scope.assert.equal(
                    sandbox
                        .files
                        .find(function productionTarget(file) {
                            return file.file === 'subject.mjs';
                        })
                        ?.mutationTarget,
                    true
                );
            });
            return scope.assert.collect();
        }
    ),
    test('rejects a selected symlink alias of a discovered test', async function (scope) {
        await withSandbox(async function assertSelectedAlias(paths) {
            const testPath = join(paths.cwd, 'case.test.mjs');
            await writeFile(testPath, 'export {};');
            await symlink(testPath, join(paths.cwd, 'alias.mjs'));
            const sandbox = await createMutationSandbox({
                ...paths,
                fileDescriptions: {
                    [join(paths.originalRoot, 'case.test.mjs')]: { mutate: false },
                    [join(paths.originalRoot, 'alias.mjs')]: { mutate: true }
                }
            });
            await scope.assert.rejects(async function selectedAlias() {
                await assertExcludedMutationFiles(sandbox, [ testPath ], 'test definitions');
            }, { type: ConfigError, message: /Exclude test definitions from Stryker mutate: case.test.mjs/ });
        });
        return scope.assert.collect();
    }),
    test('rejects metadata outside the launch root', async function (scope) {
        await withSandbox(async function assertInvalidOrigins(paths) {
            await scope.assert.rejects(async function outsideOrigin() {
                await createMutationSandbox({
                    ...paths,
                    fileDescriptions: {
                        [join(paths.cwd, 'case.test.mjs')]: { mutate: false }
                    }
                });
            }, { type: ConfigError, message: /Invalid Stryker project file origin/ });
        });
        return scope.assert.collect();
    })
]);
