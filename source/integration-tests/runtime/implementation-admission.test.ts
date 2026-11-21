import { mkdir, mkdtempDisposable, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { table, suite, test, testDouble } from '@overkill-dev/test';

import { z } from 'zod/v4';

import {
    defineImplementationReference,
    prepareImplementation,
    withPreparedImplementation,
    type ImplementationPreparation,
    type ImplementationReference,
    type PreparedImplementation
} from '../../packages/engine/engine.entry-point.ts';
import { withImplementationGraph } from '../../implementation-graph.ts';
import { withModuleLoadingScope, isDeliveredModuleImport } from '../../module-loading-scope.ts';

function preparation(
    directory: string,
    file: string,
    realm: ImplementationReference<null>['realm']
): ImplementationPreparation<null> {
    const controller = new AbortController();
    return {
        reference: defineImplementationReference({
            module: { moduleUrl: pathToFileURL(join(directory, file)).href, exportName: 'body' },
            realm,
            version: '1',
            input: null,
            dynamicModules: [],
            parseInput() {
                return null;
            }
        }),
        context: { projectRoot: directory },
        signal: controller.signal
    };
}

async function nativeValue(input: ImplementationPreparation<null>, prepared: PreparedImplementation): Promise<number> {
    return await withPreparedImplementation(
        { ...input, prepared, parseImplementation: z.number().parse },
        async function read(value) {
            return value;
        }
    );
}
async function dependencyProject(
    directory: string
): Promise<{ readonly entry: string; readonly dependency: string; readonly log: string; }> {
    const log = join(directory, 'evaluated.txt');
    await writeFile(log, '');
    await writeFile(
        join(directory, 'body.mjs'),
        [
            "import {value} from './dependency.mjs';",
            "export const body={version:'1',implementation:value};"
        ]
            .join('\n')
    );
    await writeFile(
        join(directory, 'dependency.mjs'),
        [
            "import {appendFileSync} from 'node:fs';",
            `appendFileSync(${JSON.stringify(log)},'evaluated');`,
            'export const value=42;'
        ]
            .join('\n')
    );
    return {
        entry: pathToFileURL(await realpath(join(directory, 'body.mjs'))).href,
        dependency: pathToFileURL(await realpath(join(directory, 'dependency.mjs'))).href,
        log
    };
}
async function withChangedResolution<Value>(
    target: string,
    change: (url: URL) => URL,
    operation: () => Promise<Value>
): Promise<Value> {
    return await withModuleLoadingScope({
        load(_url, nextLoad) {
            return nextLoad();
        },
        resolve(specifier, _parentURL, nextResolve) {
            const resolved = nextResolve();
            return specifier.startsWith(target) && specifier.includes('overkill-build=')
                ? { ...resolved, url: change(new URL(resolved.url)).href }
                : resolved;
        }
    }, operation);
}

export const testNode = suite('native implementation admission boundaries', [
    table({
        title: 'rejects remapped URLs before evaluating implementations',
        cases: [ 'entry', 'dependency' ] as const,
        caseTitle(kind) {
            return kind;
        },
        async test(scope) {
            const kind = scope.parameters;

            await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-remapped-implementation-'));
            const project = await dependencyProject(directory.path);
            const input = preparation(directory.path, 'body.mjs', 'host');
            const prepared = await prepareImplementation(input);
            const change = function removeBuildIdentity(url: URL): URL {
                const changed = new URL(url);
                changed.search = '';
                return changed;
            };
            await scope.assert.rejects(async function changedLoader() {
                await withChangedResolution(project[kind], change, async function load() {
                    return await nativeValue(input, prepared);
                });
            }, { message: 'Implementation module resolution changed after preparation.' });
            scope.assert.equal(await readFile(project.log, 'utf8'), '');
            return scope.assert.collect();
        }
    }),
    test('retains non-Error native resolver failures as loading errors', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-resolver-failure-'));
        const project = await dependencyProject(directory.path);
        const input = preparation(directory.path, 'body.mjs', 'host');
        const prepared = await prepareImplementation(input);
        const change = testDouble.throws<(url: URL) => URL>('resolver failed');
        await scope.assert.rejects(async function brokenResolver() {
            await withChangedResolution(project.dependency, change, async function load() {
                return await nativeValue(input, prepared);
            });
        }, { message: 'Implementation loading failed.' });
        scope.assert.equal(await readFile(project.log, 'utf8'), '');
        return scope.assert.collect();
    }),
    test('recognizes delivered import identity only while its build is active', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-import-identity-'));
        await writeFile(
            join(directory.path, 'body.mjs'),
            "export const body={version:'1',implementation:import.meta.url};"
        );
        const input = preparation(directory.path, 'body.mjs', 'host');
        const prepared = await prepareImplementation(input);
        const url = await withPreparedImplementation(
            { ...input, prepared, parseImplementation: z.string().parse },
            async function inspect(value) {
                scope.assert.true(isDeliveredModuleImport({ parentURL: value }));
                return value;
            }
        );
        scope.assert.false(isDeliveredModuleImport({ parentURL: url }));
        scope.assert.false(isDeliveredModuleImport({ parentURL: input.reference.module.moduleUrl }));
        scope.assert.false(isDeliveredModuleImport(null));
        return scope.assert.collect();
    }),
    table({
        title: 'rejects unsupported implementation URLs',
        cases: [
            'https://example.test/body.mjs',
            'file:///project/body.mjs?version=1',
            'file:///project/body.mjs#version'
        ] as const,
        caseTitle(moduleUrl) {
            return moduleUrl;
        },
        async test(scope) {
            const moduleUrl = scope.parameters;

            const input = preparation(tmpdir(), 'body.mjs', 'host');
            const reference = defineImplementationReference({
                ...input.reference,
                module: { moduleUrl, exportName: 'body' }
            });
            await scope.assert.rejects(async function prepareUnsupportedUrl() {
                await prepareImplementation({ ...input, reference });
            }, { message: `Unsupported native implementation URL: ${moduleUrl}` });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects changed inputs before evaluating implementations',
        cases: [ 'reference', 'parser' ] as const,
        caseTitle(kind) {
            return kind;
        },
        async test(scope) {
            const kind = scope.parameters;

            await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-input-drift-'));
            const project = await dependencyProject(directory.path);
            const input = preparation(directory.path, 'body.mjs', 'host');
            let calls = 0;
            const reference = defineImplementationReference({
                ...input.reference,
                input: kind === 'reference' ? 42 : null,
                parseInput(value) {
                    calls += 1;
                    return kind === 'parser' && calls === 2 ? 42 : z.union([ z.number(), z.null() ]).parse(value);
                }
            });
            const prepared = await prepareImplementation(kind === 'parser' ? { ...input, reference } : input);
            await scope.assert.rejects(async function changedInputs() {
                await withPreparedImplementation(
                    { ...input, reference, prepared, parseImplementation: z.number().parse },
                    async function execute() {
                        throw new Error('Implementation executed');
                    }
                );
            }, { message: 'Implementation inputs changed; prepare and collect a new run.' });
            scope.assert.equal(await readFile(project.log, 'utf8'), '');
            return scope.assert.collect();
        }
    }),
    test('rejects browser references before reading host module files', async function (scope) {
        await scope.assert.rejects(async function unsupportedRealm() {
            await prepareImplementation(preparation(tmpdir(), 'absent.mjs', 'browser'));
        }, { message: 'The native implementation loader supports the host realm only.' });
        return scope.assert.collect();
    }),
    test('surfaces unreadable package metadata instead of treating it as absent', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-package-metadata-'));
        await mkdir(join(directory.path, 'package.json'));
        await writeFile(join(directory.path, 'body.mjs'), 'export const body={version:"1",implementation:42};');
        await scope.assert.rejects(async function unreadablePackage() {
            await prepareImplementation(preparation(directory.path, 'body.mjs', 'host'));
        }, { message: /EISDIR/u });
        return scope.assert.collect();
    }),
    test('admits native JSON exports without losing their value', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-json-implementation-'));
        await writeFile(join(directory.path, 'body.json'), JSON.stringify({ version: '1', implementation: 42 }));
        const input = preparation(directory.path, 'body.json', 'host');
        const reference = defineImplementationReference({
            ...input.reference,
            module: { ...input.reference.module, exportName: 'default' }
        });
        const request = { ...input, reference };
        const prepared = await prepareImplementation(request);
        const result = await nativeValue(request, prepared);
        scope.assert.equal(result, 42);
        scope.assert.equal(prepared.graph.modules[0]?.format, 'json');
        return scope.assert.collect();
    }),
    test('rejects forged graph identities before evaluating modules', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-forged-graph-'));
        await writeFile(join(directory.path, 'body.mjs'), 'throw new Error("Module evaluated");');
        const prepared = await prepareImplementation(preparation(directory.path, 'body.mjs', 'host'));
        await scope.assert.rejects(async function alteredIdentity() {
            await withImplementationGraph({ ...prepared.graph, build: 'forged' }, async function execute() {
                throw new Error('Operation executed');
            });
        }, { message: 'Invalid implementation graph identity.' });
        await scope.assert.rejects(async function unassignedEntry() {
            await withImplementationGraph(prepared.graph, async function loadUnassigned(load) {
                return await load(pathToFileURL(join(directory.path, 'outside.mjs')).href);
            });
        }, { message: 'Implementation entry is outside the frozen graph.' });
        return scope.assert.collect();
    }),
    test('records declared builtin candidates without evaluating an implementation', async function (scope) {
        await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-builtin-candidate-'));
        await writeFile(join(directory.path, 'body.mjs'), 'throw new Error("Module evaluated");');
        const input = preparation(directory.path, 'body.mjs', 'host');
        const reference = defineImplementationReference({
            ...input.reference,
            dynamicModules: [ { moduleUrl: 'node:fs', exportName: 'readFileSync' } ]
        });
        const prepared = await prepareImplementation({ ...input, reference });
        scope.assert.deepEqual(prepared.graph.builtins, [ 'node:fs' ]);
        scope.assert.equal(prepared.graph.entries['node:fs'], 'node:fs');
        return scope.assert.collect();
    })
]);
