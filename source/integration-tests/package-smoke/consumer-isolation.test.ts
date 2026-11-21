import { createProgram, ModuleKind } from 'typescript';
import { consumerCompilerTypes, consumerTypeDiagnostics } from './support/consumer-types.ts';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { suite, table, test } from '@overkill-dev/test';
import { consumerEnvironment } from './support/consumer-environment.ts';

const execute = promisify(execFile);

export const testNode = suite('Packed consumer isolation', [
    test('hosts tests with the repository npm installation', async function (scope) {
        const framework = await realpath(fileURLToPath(import.meta.resolve('@overkill-dev/test')));
        const installation = await realpath(
            fileURLToPath(new URL('../../../node_modules/@overkill-dev/test/', import.meta.url))
        );
        scope.assert.true(framework.startsWith(`${installation}${sep}`));
        return scope.assert.collect();
    }),
    table({
        title: 'rejects dependencies found only in ancestor installations',
        cases: [ '@overkill-dev/test', 'zod/v4' ],
        caseTitle(specifier) {
            return specifier;
        },
        async test(scope) {
            const directory = await mkdtemp(join(resolve('target'), 'missing-package-consumer-'));
            scope.cleanup(async function removeConsumer() {
                await rm(directory, { recursive: true, force: true });
            });
            await scope.assert.rejects(async function importMissingDependency() {
                await execute(process.execPath, [
                    '--input-type=module',
                    '--eval',
                    `await import(${JSON.stringify(scope.parameters)})`
                ], { cwd: directory, env: consumerEnvironment(process.env, directory) });
            }, { message: /Consumer resolved an uninstalled (?:Overkill )?dependency/u });
            return scope.assert.collect();
        }
    }),
    test('rejects declarations found only in an ancestor installation', async function (scope) {
        const directory = await mkdtemp(join(resolve('target'), 'missing-types-consumer-'));
        scope.cleanup(async function removeConsumer() {
            await rm(directory, { recursive: true, force: true });
        });
        await mkdir(join(directory, 'node_modules'));
        const file = join(directory, 'consumer.mts');
        await writeFile(file, "import { suite } from '@overkill-dev/test'; suite('consumer', []);");
        const program = createProgram([ file ], {
            ...consumerCompilerTypes,
            module: ModuleKind.NodeNext,
            noEmit: true
        });
        await scope.assert.rejects(async function rejectAncestorTypes() {
            await consumerTypeDiagnostics(program, directory);
        }, { message: /TypeScript resolved an uninstalled declaration/u });
        return scope.assert.collect();
    })
]);
