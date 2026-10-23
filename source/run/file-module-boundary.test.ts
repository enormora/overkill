import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { loadConfig } from '../packages/run/config.entry-point.ts';
import { RunResolutionError, withFileModuleBoundary } from '../packages/run/run.entry-point.ts';

type ProjectDirectories = {
    readonly root: string;
    readonly other: string;
};

async function withProjectDirectories(operation: (paths: ProjectDirectories) => Promise<void>): Promise<void> {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'overkill-module-boundary-')));
    const root = join(directory, 'sandbox');
    const other = join(directory, 'original');
    try {
        await mkdir(root);
        await mkdir(other);
        await writeFile(join(other, 'escape.mjs'), 'throw new Error("original module evaluated");');
        await writeFile(join(other, 'escape.cjs'), 'throw new Error("original module evaluated");');
        await operation({ root, other });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

export const testNode = suite('file module boundaries', [
    test('rejects missing outside modules before filesystem resolution', async function (scope) {
        await withProjectDirectories(async function assertMissingEscapes({ root, other }) {
            const boundary = { projectRoot: root, sharedRoots: [] };
            const missing = join(other, 'missing.mjs');
            await writeFile(join(root, 'relative.mjs'), 'import "../original/missing.mjs";');
            for (const href of [ pathToFileURL(missing).href, pathToFileURL(join(root, 'relative.mjs')).href ]) {
                await scope.assert.rejects(async function importOutsideRoot() {
                    await withFileModuleBoundary(boundary, async function loadOutsideRoot() {
                        await import(href);
                    });
                }, { type: RunResolutionError, message: /Module import escapes/ });
            }
            await scope.assert.rejects(async function requireOutsideRoot() {
                await withFileModuleBoundary(boundary, async function loadOutsideRoot() {
                    createRequire(pathToFileURL(join(root, 'config.mjs')))(missing);
                });
            }, { type: RunResolutionError, message: /Module import escapes/ });
        });
        return scope.assert.collect();
    }),
    test('allows imports through declared project and shared root symlinks', async function (scope) {
        await withProjectDirectories(async function assertDeclaredAliases({ root, other }) {
            const projectAlias = join(other, 'project-link');
            const shared = join(other, 'installed-package');
            const sharedAlias = join(other, 'shared-link');
            await mkdir(shared);
            await symlink(root, projectAlias);
            await symlink(shared, sharedAlias);
            await writeFile(join(shared, 'value.mjs'), 'export const value = "shared-alias";');
            await writeFile(
                join(root, 'config.mjs'),
                `import {value} from ${JSON.stringify(pathToFileURL(join(sharedAlias, 'value.mjs')).href)};
export const config = {runtimeStateDir:value};`
            );
            const config = await withFileModuleBoundary(
                { projectRoot: projectAlias, sharedRoots: [ sharedAlias ] },
                async function loadDeclaredAliases() {
                    return await loadConfig({ cwd: projectAlias, configPath: 'config.mjs' });
                }
            );
            scope.assert.equal(config.runtimeStateDir, 'shared-alias');
        });
        return scope.assert.collect();
    }),
    test('rejects shared roots that contain the project after resolving symlinks', async function (scope) {
        await withProjectDirectories(async function assertCanonicalRoots({ root, other }) {
            const shared = join(other, 'shared');
            await symlink(join(root, '..'), shared);
            let executed = false;
            await scope.assert.rejects(async function useOverlappingRoots() {
                await withFileModuleBoundary(
                    { projectRoot: root, sharedRoots: [ shared ] },
                    async function runOperation() {
                        executed = true;
                    }
                );
            }, { type: RunResolutionError, message: /Shared module roots must not contain/ });
            scope.assert.equal(executed, false);
        });
        return scope.assert.collect();
    }),
    test('allows built-in and data modules inside a file boundary', async function (scope) {
        await withProjectDirectories(async function assertNonFileModules({ root }) {
            const value = await withFileModuleBoundary(
                { projectRoot: root, sharedRoots: [] },
                async function loadNonFileModules() {
                    const path = await import('node:path');
                    const source = 'data:text/javascript,export default "sandbox"';
                    await import(source);
                    return path.join(root, 'sandbox');
                }
            );
            scope.assert.equal(value, join(root, 'sandbox'));
        });
        return scope.assert.collect();
    }),
    test('rejects absolute ESM and CommonJS imports before evaluating original files', async function (scope) {
        await withProjectDirectories(async function assertEscapes({ root, other }) {
            const boundary = { projectRoot: root, sharedRoots: [] };
            await scope.assert.rejects(async function importOriginal() {
                await withFileModuleBoundary(boundary, async function loadOriginal() {
                    await import(pathToFileURL(join(other, 'escape.mjs')).href);
                });
            }, { type: RunResolutionError, message: /Module import escapes/ });
            await scope.assert.rejects(async function requireOriginal() {
                await withFileModuleBoundary(boundary, async function loadOriginal() {
                    createRequire(pathToFileURL(join(root, 'config.mjs')))(join(other, 'escape.cjs'));
                });
            }, { type: RunResolutionError, message: /Module import escapes/ });
        });
        return scope.assert.collect();
    }),
    test('does not restrict unrelated operations while a boundary is active', async function (scope) {
        await withProjectDirectories(async function assertIndependentOperation({ root, other }) {
            await writeFile(join(other, 'config.mjs'), 'export const config = {runtimeStateDir:"unbounded"};');
            const ready = Promise.withResolvers<undefined>();
            const release = Promise.withResolvers<undefined>();
            const bounded = withFileModuleBoundary(
                { projectRoot: root, sharedRoots: [] },
                async function keepBoundaryActive() {
                    ready.resolve(undefined);
                    await release.promise;
                }
            );
            await ready.promise;
            try {
                const config = await withFileModuleBoundary(null, async function loadUnrelatedConfig() {
                    return await loadConfig({ cwd: other, configPath: 'config.mjs' });
                });
                scope.assert.equal(config.runtimeStateDir, 'unbounded');
            } finally {
                release.resolve(undefined);
                await bounded;
            }
        });
        return scope.assert.collect();
    }),
    test('rejects symlink escapes and allows sandbox dependencies', async function (scope) {
        await withProjectDirectories(async function assertSymlink({ root, other }) {
            await symlink(join(other, 'escape.mjs'), join(root, 'linked.mjs'));
            await writeFile(join(root, 'directory.mjs'), 'export const directory = "bounded";');
            await writeFile(
                join(root, 'config.mjs'),
                'import {directory} from "./directory.mjs"; export const config = {runtimeStateDir:directory};'
            );
            const boundary = { projectRoot: root, sharedRoots: [] };
            await scope.assert.rejects(async function importSymlink() {
                await withFileModuleBoundary(boundary, async function loadLinkedModule() {
                    await import(pathToFileURL(join(root, 'linked.mjs')).href);
                });
            }, { type: RunResolutionError, message: /Module import escapes/ });
            const config = await withFileModuleBoundary(boundary, async function loadSandboxConfig() {
                return await loadConfig({ cwd: root, configPath: 'config.mjs' });
            });
            scope.assert.equal(config.runtimeStateDir, 'bounded');
        });
        return scope.assert.collect();
    }),
    test('isolates concurrent scopes and removes hooks after failure', async function (scope) {
        await withProjectDirectories(async function assertConcurrentScopes({ root, other }) {
            await writeFile(join(root, 'config.mjs'), 'export const config = {runtimeStateDir:"first"};');
            await writeFile(join(other, 'config.mjs'), 'export const config = {runtimeStateDir:"second"};');
            const configs = await Promise.all([ root, other ].map(async function loadOwnConfig(projectRoot) {
                return await withFileModuleBoundary(
                    { projectRoot, sharedRoots: [] },
                    async function loadScopedConfig() {
                        return await loadConfig({ cwd: projectRoot, configPath: 'config.mjs' });
                    }
                );
            }));
            scope.assert.deepEqual(
                configs.map(function stateDirectory(config) {
                    return config.runtimeStateDir;
                }),
                [ 'first', 'second' ]
            );
            await scope.assert.rejects(async function failOperation() {
                await withFileModuleBoundary(
                    { projectRoot: root, sharedRoots: [] },
                    async function failInsideBoundary() {
                        throw new Error('operation failed');
                    }
                );
            }, { message: 'operation failed' });
            const config = await loadConfig({ cwd: other, configPath: 'config.mjs' });
            scope.assert.equal(config.runtimeStateDir, 'second');
        });
        return scope.assert.collect();
    }),
    test('allows explicit shared roots without broadening sibling project access', async function (scope) {
        await withProjectDirectories(async function assertSharedRoots({ root, other }) {
            const shared = join(other, 'installed-package');
            await mkdir(shared);
            await writeFile(join(shared, 'config.mjs'), 'export const config = {runtimeStateDir:"shared"};');
            const boundary = { projectRoot: root, sharedRoots: [ shared ] };
            const config = await withFileModuleBoundary(boundary, async function loadInstalledConfig() {
                return await loadConfig({ cwd: shared, configPath: 'config.mjs' });
            });
            scope.assert.equal(config.runtimeStateDir, 'shared');
            await scope.assert.rejects(async function importSibling() {
                await withFileModuleBoundary(boundary, async function loadOriginalModule() {
                    await import(pathToFileURL(join(other, 'escape.mjs')).href);
                });
            }, { message: /Module import escapes/ });
        });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
