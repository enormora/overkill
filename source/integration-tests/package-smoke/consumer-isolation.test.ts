import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProgram, ModuleKind } from 'typescript';
import { createTestFacade, suite, table, test } from '@overkill-dev/test';
import { testWorkspace } from '../../test-support/test-workspace.ts';
import { consumerCompilerTypes, consumerTypeDiagnostics } from './support/consumer-types.ts';
import { sealConsumerDependencies } from './support/consumer-resolution-boundary.ts';
import { consumerEnvironment } from './support/consumer-environment.ts';

const ancestorConsumer = createTestFacade({ resources: { workspace: testWorkspace } });

async function createAncestorInstallation(directory: string, specifier: string): Promise<string> {
    const dependency = join(directory, 'node_modules', specifier);
    await mkdir(dependency, { recursive: true });
    await writeFile(
        join(dependency, 'package.json'),
        JSON.stringify({ name: specifier, type: 'module', exports: './index.js' })
    );
    await writeFile(join(dependency, 'index.js'), 'export const ancestor = true;');
    const consumer = join(directory, 'consumer');
    await mkdir(consumer);
    return consumer;
}

async function importConsumerDependency(
    directory: string,
    specifier: string,
    environment: Readonly<Record<string, string>>
): Promise<void> {
    await new Promise<void>(function importInChild(resolve, reject) {
        execFile(
            process.execPath,
            [
                '--disable-warning=PERM0004',
                '--input-type=module',
                '--eval',
                `await import(${JSON.stringify(specifier)})`
            ],
            { cwd: directory, env: environment },
            function completed(error: Error | null) {
                if (error === null) {
                    resolve();
                } else {
                    reject(error);
                }
            }
        );
    });
}

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
            const directory = await mkdtemp(join(resolvePath('target'), 'missing-package-consumer-'));
            scope.cleanup(async function removeConsumer() {
                await rm(directory, { recursive: true, force: true });
            });
            await scope.assert.rejects(async function importMissingDependency() {
                await importConsumerDependency(directory, scope.parameters, consumerEnvironment(directory));
            }, { message: /Consumer resolved an uninstalled (?:Overkill )?dependency/u });
            return scope.assert.collect();
        }
    }),
    test('rejects declarations found only in an ancestor installation', async function (scope) {
        const directory = await mkdtemp(join(resolvePath('target'), 'missing-types-consumer-'));
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
    }),
    ancestorConsumer.table({
        title: 'blocks ancestor fallback after a child clears Node options',
        cases: [ 'ancestor-only', '@ancestor/only' ],
        caseTitle: String,
        async test(scope) {
            const consumer = await createAncestorInstallation(scope.resources.workspace, scope.parameters);
            await importConsumerDependency(consumer, scope.parameters, { NODE_OPTIONS: '' });
            await sealConsumerDependencies(consumer);
            await scope.assert.rejects(async function importBlockedAncestor() {
                await importConsumerDependency(consumer, scope.parameters, { NODE_OPTIONS: '' });
            }, { message: /ERR_PACKAGE_PATH_NOT_EXPORTED/u });
            return scope.assert.collect();
        }
    })
]);
