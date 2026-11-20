import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { frozenTypeProject } from '../../../../test-support/frozen-type-project.ts';
import { createEngine } from '../../../../packages/engine/engine.entry-point.ts';
import {
    resolveInstalledCompiler,
    verifyInstalledCompiler
} from '../../../../packages/type-test/installed-compiler.ts';
import { typeTestSettingsSchema } from '../../../../packages/type-test/profile-settings.ts';
import { prepare } from '../../../../packages/type-test/compiler-plan.ts';

const installed = dirname(createRequire(import.meta.url).resolve('typescript-beta/package.json'));
async function project(scope: TestScope): Promise<string> {
    const root = await frozenTypeProject(scope, {
        'tsconfig.json': '{"compilerOptions":{"noLib":true,"types":[]},"files":["case.ts"]}',
        'case.ts': 'export type Value = string;'
    });
    await mkdir(join(root, 'node_modules'));
    for (const name of [ 'typescript', 'compiler-alias' ]) {
        await symlink(installed, join(root, 'node_modules', name), 'dir');
    }
    return root;
}
export const testNode: TestNode = suite('installed compiler selection', [
    test('resolves local and package aliases from the explicit root', async function (scope) {
        const root = await project(scope);
        const local = await resolveInstalledCompiler(root, { kind: 'local' });
        const alias = await resolveInstalledCompiler(root, {
            kind: 'package',
            specifier: 'compiler-alias',
            version: '7.1.0-beta'
        });
        scope.assert.equal(local.packageUrl, alias.packageUrl);
        scope.assert.deepEqual(local.files, alias.files);
        scope.assert.equal(local.version, '7.1.0-beta');
        await verifyInstalledCompiler(local);
        return scope.assert.collect();
    }),
    test('rejects missing, mismatched, and unsupported installed compilers', async function (scope) {
        const root = await project(scope);
        await scope.assert.rejects(
            async function () {
                return resolveInstalledCompiler(root, { kind: 'package', specifier: 'missing', version: '7.1.0-beta' });
            },
            { message: /Cannot find module/u }
        );
        await scope.assert.rejects(
            async function () {
                return resolveInstalledCompiler(root, {
                    kind: 'package',
                    specifier: 'compiler-alias',
                    version: '7.1.0'
                });
            },
            { message: /exact version/u }
        );
        await mkdir(join(root, 'node_modules', 'unsupported'));
        await writeFile(
            join(root, 'node_modules', 'unsupported', 'package.json'),
            '{"name":"typescript","version":"6.0.3"}'
        );
        await scope.assert.rejects(
            async function () {
                return resolveInstalledCompiler(root, { kind: 'package', specifier: 'unsupported', version: '6.0.3' });
            },
            { message: /Unsupported TypeScript/u }
        );
        scope.assert.false(
            typeTestSettingsSchema
                .safeParse({ projectConfigPath: 'tsconfig.json', compiler: { kind: 'version', version: '7.1.0-beta' } })
                .success
        );
        return scope.assert.collect();
    }),
    test(
        'deduplicates one installation and rejects conflicting same-version installations',
        async function (scope) {
            const root = await project(scope);
            const engine = createEngine();
            const plan = engine.createTestPlan(
                engine.createRoot({
                    title: 'selection',
                    annotations: {},
                    controls: {},
                    children: [
                        engine.createSkippedTestCase({
                            title: 'skip',
                            annotations: {},
                            controls: {},
                            definitionLocations: [ { kind: 'unknown' } ],
                            reason: 'selection only'
                        })
                    ]
                })
            );
            const prepared = await prepare(plan, {
                projectConfigPath: 'tsconfig.json',
                compiler: {
                    kind: 'matrix',
                    compilers: [ { kind: 'local' }, {
                        kind: 'package',
                        specifier: 'compiler-alias',
                        version: '7.1.0-beta'
                    } ]
                }
            }, root);
            scope.cleanup(async function () {
                await prepared.dispose();
            });
            scope.assert.equal(prepared.testPlan.cases.length, 1);
            await cp(installed, join(root, 'node_modules', 'other-compiler'), { recursive: true });
            await symlink(`${dirname(installed)}/@typescript`, join(root, 'node_modules', '@typescript'), 'dir');
            await scope.assert.rejects(
                async function () {
                    return prepare(plan, {
                        projectConfigPath: 'tsconfig.json',
                        compiler: {
                            kind: 'matrix',
                            compilers: [ { kind: 'local' }, {
                                kind: 'package',
                                specifier: 'other-compiler',
                                version: '7.1.0-beta'
                            } ]
                        }
                    }, root);
                },
                { message: /Conflicting compiler/u }
            );
            return scope.assert.collect();
        }
    )
]);
