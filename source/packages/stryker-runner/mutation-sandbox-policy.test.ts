import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import {
    sandboxPaths,
    sandboxInput,
    sandboxFixture,
    sandboxSettings
} from '../../test-support/mutation-sandbox-paths.ts';
import {
    prepareMutationSandbox,
    sandboxModuleBoundary,
    sandboxRunnerOptions,
    validateProtectedMutationFiles
} from './mutation-sandbox.ts';

export const testNode = suite('mutation sandbox origin policy', [
    test('preserves original file roles and discovers external module roots', async function (scope: TestScope) {
        const result = await prepareMutationSandbox(
            sandboxInput,
            sandboxPaths([ '/dependencies', '/dependencies', '/sandbox/node_modules' ], new Map(), null)
        );
        scope.assert.deepEqual(result.files, sandboxFixture.files);
        scope.assert.equal(
            result
                .sharedRoots
                .filter(function (root) {
                    return root === '/dependencies';
                })
                .length,
            1
        );
        scope.assert.equal(result.sharedRoots.includes('/sandbox/node_modules'), false);
        scope.assert.deepEqual(sandboxModuleBoundary(result), {
            projectRoot: '/sandbox',
            sharedRoots: result.sharedRoots
        });
        return scope.assert.collect();
    }),
    test('rejects relative and escaped original file descriptions', async function (scope: TestScope) {
        for (const file of [ 'subject.ts', '/elsewhere/subject.ts', '/original' ]) {
            await scope.assert.rejects(async function () {
                return await prepareMutationSandbox(
                    { ...sandboxInput, fileDescriptions: { [file]: { mutate: true } } },
                    sandboxPaths([], new Map(), null)
                );
            }, { message: /Invalid Stryker project file origin/u });
        }
        return scope.assert.collect();
    }),
    test('rejects shared module roots containing the original project', async function (scope: TestScope) {
        await scope.assert.rejects(async function () {
            return await prepareMutationSandbox(sandboxInput, sandboxPaths([ '/' ], new Map(), null));
        }, { message: /contains the original project/u });
        return scope.assert.collect();
    }),
    test('ignores missing optional module search roots', async function (scope: TestScope) {
        const paths = sandboxPaths([ '/missing' ], new Map(), null);
        const result = await prepareMutationSandbox(sandboxInput, {
            ...paths,
            async canonical(path) {
                if (path === '/missing') {
                    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
                }
                return path;
            }
        });
        scope.assert.equal(result.sharedRoots.includes('/missing'), false);
        return scope.assert.collect();
    }),
    test('propagates canonicalization failures', async function (scope: TestScope) {
        const failure = new Error('permission denied');
        await scope.assert.rejects(async function () {
            return await prepareMutationSandbox(sandboxInput, sandboxPaths([], new Map(), failure));
        }, { exact: failure });
        return scope.assert.collect();
    }),
    test('translates original paths and file URLs into sandbox paths', function (scope: TestScope) {
        const result = sandboxRunnerOptions(sandboxFixture, {
            ...sandboxSettings,
            configPath: '/original/config.ts',
            paths: [ 'subject.ts', 'file:///original/test.ts', '/sandbox/local.ts' ]
        });
        scope.assert.equal(result.configPath, '/sandbox/config.ts');
        scope.assert.deepEqual(result.paths, [ '/sandbox/subject.ts', '/sandbox/test.ts', '/sandbox/local.ts' ]);
        scope.assert.equal(sandboxRunnerOptions(sandboxFixture, sandboxSettings).configPath, null);
        return scope.assert.collect();
    }),
    test('rejects runner paths outside both project roots', function (scope: TestScope) {
        for (const path of [ '../outside.ts', '/other/outside.ts' ]) {
            scope.assert.throws(function () {
                return sandboxRunnerOptions(sandboxFixture, { ...sandboxSettings, paths: [ path ] });
            }, { message: /escapes the Stryker sandbox/u });
        }
        return scope.assert.collect();
    }),
    test('rejects mutations of protected files after resolving aliases', async function (scope: TestScope) {
        const paths = sandboxPaths([], new Map([ [ '/sandbox/alias.ts', '/sandbox/subject.ts' ] ]), null);
        await scope.assert.rejects(async function () {
            await validateProtectedMutationFiles(sandboxFixture, [ '/sandbox/alias.ts' ], 'tests', paths.canonical);
        }, { message: 'Exclude tests from Stryker mutate: subject.ts' });
        return scope.assert.collect();
    }),
    test('accepts excluded protected files and missing target paths', async function (scope: TestScope) {
        const paths = sandboxPaths([], new Map(), Object.assign(new Error('missing'), { code: 'ENOENT' }));
        await validateProtectedMutationFiles(sandboxFixture, [ '/sandbox/test.ts' ], 'tests', paths.canonical);
        scope.assert.throws(function () {
            return sandboxRunnerOptions(sandboxFixture, { ...sandboxSettings, configPath: '/outside/config.ts' });
        }, { message: /escapes the Stryker sandbox/u });
        return scope.assert.collect();
    }),
    test('rejects protected aliases escaping the sandbox', async function (scope: TestScope) {
        const paths = sandboxPaths([], new Map([ [ '/sandbox/test.ts', '/outside/test.ts' ] ]), null);
        await scope.assert.rejects(async function () {
            await validateProtectedMutationFiles(sandboxFixture, [ '/sandbox/test.ts' ], 'tests', paths.canonical);
        }, { message: 'Mutation target escapes the Stryker sandbox: /sandbox/test.ts' });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
