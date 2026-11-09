import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import compiler from 'typescript';
import { runIfMain } from '#test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import { frozenTypeProject } from '../../test-support/frozen-type-project.ts';
import { captureProjectInputs, verifyProjectInputs } from './frozen-inputs.ts';

const projectFiles = {
    'tsconfig.json': '{"extends":"./base.json","files":["case.ts"]}',
    'base.json': '{"compilerOptions":{"strict":true,"types":[],"noLib":true}}',
    'case.ts': "import type { Value } from './value.js'; export type Result = Value;",
    'value.d.ts': 'export type Value = string;'
};

export const testNode = suite('frozen compiler inputs', [
    ...([ 'value.d.ts', 'base.json' ] as const).map(function (file) {
        return test(`detects changes to ${file}`, async function (scope) {
            const directory = await frozenTypeProject(scope, projectFiles);
            const frozen = captureProjectInputs(compiler, join(directory, 'tsconfig.json'));
            verifyProjectInputs(compiler, frozen.inputs);
            scope.assert.true(frozen.inputs.files.some(function (input) {
                return input.path === join(directory, file);
            }));
            await writeFile(join(directory, file), `${projectFiles[file]}\n`);
            scope.assert.throws(function () {
                verifyProjectInputs(compiler, frozen.inputs);
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
        const frozen = captureProjectInputs(compiler, join(directory, 'tsconfig.json'));
        scope.assert.true(frozen.inputs.directoryEntries.some(function (entry) {
            return entry.path === types;
        }));
        verifyProjectInputs(compiler, frozen.inputs);
        await mkdir(join(types, 'added'));
        await writeFile(join(types, 'added', 'index.d.ts'), 'declare const added: string;');
        scope.assert.throws(function () {
            verifyProjectInputs(compiler, frozen.inputs);
        }, { message: /resolution changed/u });
        return scope.assert.collect();
    }),
    test('detects newly created resolution candidates', async function (scope) {
        const directory = await frozenTypeProject(scope, {
            'tsconfig.json': '{"compilerOptions":{"types":[],"noLib":true},"files":["case.ts"]}',
            'case.ts': "import type { Value } from './missing.js'; export type Result = Value;"
        });
        const frozen = captureProjectInputs(compiler, join(directory, 'tsconfig.json'));
        verifyProjectInputs(compiler, frozen.inputs);
        await writeFile(join(directory, 'missing.ts'), 'export type Value = string;');
        scope.assert.throws(function () {
            verifyProjectInputs(compiler, frozen.inputs);
        }, { message: /resolution changed/u });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
