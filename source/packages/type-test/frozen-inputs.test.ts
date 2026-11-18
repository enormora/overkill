import { writeFile, mkdir, symlink, unlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { frozenTypeProject } from '../../test-support/frozen-type-project.ts';
import { verifyProjectInputs } from './frozen-inputs.ts';
import { loadProject, disposeProject, type FrozenProject } from './frozen-project.ts';
import { projectSourceAnalysis } from './native-execution.ts';
import { originalSourceFile } from './source-analysis.ts';

const projectFiles = {
    'tsconfig.json': '{"extends":"./base.json","files":["case.ts"]}',
    'base.json': '{"compilerOptions":{"strict":true,"types":[],"noLib":true}}',
    'case.ts': "import type { Value } from './value.js'; export type Result = Value;",
    'value.d.ts': 'export type Value = string;'
};
async function linkedProject(scope: TestScope): Promise<{
    readonly directory: string;
    readonly alias: string;
    readonly frozen: FrozenProject;
}> {
    const directory = await frozenTypeProject(scope, {
        'original/tsconfig.json': '{"compilerOptions":{"types":[],"noLib":true},"files":["case.ts"]}',
        'original/case.ts': 'export type Value = string;',
        'replacement/tsconfig.json': '{"compilerOptions":{"types":[],"noLib":true},"files":["case.ts"]}',
        'replacement/case.ts': 'export type Value = string;'
    });
    const alias = join(directory, 'alias');
    await symlink(join(directory, 'original'), alias, 'dir');
    const frozen = await loadProject(join(alias, 'tsconfig.json'), {
        kind: 'package',
        specifier: 'typescript-beta',
        version: '7.1.0-beta'
    }, process.cwd());
    scope.cleanup(async function () {
        await disposeProject(frozen);
    });
    return { directory, alias, frozen };
}

export const testNode = suite('frozen compiler inputs', [
    test('matches canonical callback paths and detects changed project links', async function (scope) {
        const { directory, alias, frozen } = await linkedProject(scope);
        const file = await originalSourceFile(
            projectSourceAnalysis(frozen),
            await realpath(join(directory, 'original/case.ts'))
        );
        scope.assert.equal(file?.fileName, join(alias, 'case.ts'));
        verifyProjectInputs(frozen.inputs);
        await unlink(alias);
        await symlink(join(directory, 'replacement'), alias, 'dir');
        scope.assert.throws(function () {
            verifyProjectInputs(frozen.inputs);
        }, { message: /input changed/u });
        return scope.assert.collect();
    }),
    ...([ 'value.d.ts', 'base.json' ] as const).map(function (file) {
        return test(`detects changes to ${file}`, async function (scope) {
            const directory = await frozenTypeProject(scope, projectFiles);
            const frozen = await loadProject(join(directory, 'tsconfig.json'), {
                kind: 'package',
                specifier: 'typescript-beta',
                version: '7.1.0-beta'
            }, process.cwd());
            scope.cleanup(async function () {
                await disposeProject(frozen);
            });
            verifyProjectInputs(frozen.inputs);
            scope.assert.true(frozen.inputs.files.some(function (input) {
                return input.path === join(directory, file);
            }));
            await writeFile(join(directory, file), `${projectFiles[file]}\n`);
            scope.assert.throws(function () {
                verifyProjectInputs(frozen.inputs);
            }, { message: /input changed/u });
            return scope.assert.collect();
        });
    }),
    test('detects changes to automatic type discovery', async function (scope) {
        const directory = await frozenTypeProject(scope, {
            'tsconfig.json': '{"compilerOptions":{"noLib":true,"types":["*"]},"files":["case.ts"]}',
            'case.ts': 'export type Value = string;',
            'node_modules/@types/.keep': ''
        });
        const types = join(directory, 'node_modules', '@types');
        const frozen = await loadProject(join(directory, 'tsconfig.json'), {
            kind: 'package',
            specifier: 'typescript-beta',
            version: '7.1.0-beta'
        }, process.cwd());
        scope.cleanup(async function () {
            await disposeProject(frozen);
        });
        scope.assert.true(frozen.inputs.directoryEntries.some(function (entry) {
            return entry.path === types;
        }));
        verifyProjectInputs(frozen.inputs);
        await mkdir(join(types, 'added'));
        await writeFile(join(types, 'added', 'index.d.ts'), 'declare const added: string;');
        scope.assert.throws(function () {
            verifyProjectInputs(frozen.inputs);
        }, { message: /input changed/u });
        return scope.assert.collect();
    }),
    test('detects newly created resolution candidates', async function (scope) {
        const directory = await frozenTypeProject(scope, {
            'tsconfig.json': '{"compilerOptions":{"types":[],"noLib":true},"files":["case.ts"]}',
            'case.ts': "import type { Value } from './missing.js'; export type Result = Value;"
        });
        const frozen = await loadProject(join(directory, 'tsconfig.json'), {
            kind: 'package',
            specifier: 'typescript-beta',
            version: '7.1.0-beta'
        }, process.cwd());
        scope.cleanup(async function () {
            await disposeProject(frozen);
        });
        verifyProjectInputs(frozen.inputs);
        await writeFile(join(directory, 'missing.ts'), 'export type Value = string;');
        scope.assert.throws(function () {
            verifyProjectInputs(frozen.inputs);
        }, { message: /input changed/u });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
