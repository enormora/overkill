import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { createTemporaryDirectoryResource, startResources } from '../../packages/resources/resources.entry-point.ts';

import {
    defineImplementationReference,
    prepareImplementation,
    withPreparedImplementation,
    type ImplementationPreparation
} from '../../packages/engine/engine.entry-point.ts';

type NativeObserver = { readonly observe: (value: URL) => number; };
type ObserverFactory = (input: null) => NativeObserver;

async function fixture<Value>(
    signal: Readonly<AbortSignal>,
    use: (directory: string) => Promise<Value>
): Promise<Value> {
    await using session = await startResources({
        resources: { directory: createTemporaryDirectoryResource('directory') },
        signal
    });
    return await use(session.context.directory.path);
}

function request(directory: string, dynamicModules: readonly string[]): ImplementationPreparation<null> {
    const controller = new AbortController();
    return {
        reference: defineImplementationReference({
            module: { moduleUrl: pathToFileURL(join(directory, 'body.mjs')).href, exportName: 'body' },
            realm: 'host',
            version: '1',
            input: null,
            parseInput() {
                return null;
            },
            dynamicModules: dynamicModules.map(function moduleReference(file) {
                return { moduleUrl: pathToFileURL(join(directory, file)).href, exportName: 'value' };
            })
        }),
        context: { projectRoot: directory },
        signal: controller.signal
    };
}

export const testNode = suite('portable implementation graphs', [
    test(
        'resolves standalone observer factories while retaining native callback state locally',
        async function (scope) {
            await fixture(scope.signal, async function check(directory) {
                await writeFile(
                    join(directory, 'body.mjs'),
                    [
                        "export const observer={version:'1',implementation(){const observations=new Set();",
                        'return {observe(value){observations.add(value);return observations.size;}};}};'
                    ]
                        .join('\n')
                );
                const original = request(directory, []);
                const reference = defineImplementationReference({
                    ...original.reference,
                    module: {
                        ...original
                            .reference
                            .module,
                        exportName: 'observer'
                    }
                });
                const input = { ...original, reference };
                const prepared = await prepareImplementation(input);
                const parseImplementation = z
                    .custom<ObserverFactory>(function callable(value) {
                        return typeof value === 'function';
                    })
                    .parse;
                const count = await withPreparedImplementation(
                    { ...input, prepared, parseImplementation },
                    async function observe(factory, parsedInput) {
                        const observer = factory(parsedInput);
                        const value = new URL('https://example.test/');
                        observer.observe(value);
                        return observer.observe(value);
                    }
                );
                scope.assert.equal(count, 1);
            });
            return scope.assert.collect();
        }
    ),
    test('prepares without evaluation and rejects transitive drift before loading', async function (scope) {
        await fixture(scope.signal, async function check(directory) {
            await writeFile(join(directory, 'value.mjs'), 'export const value = 42;');
            await writeFile(
                join(directory, 'body.mjs'),
                [
                    "import { value } from './value.mjs';",
                    "throw new Error('Must not evaluate during preparation');",
                    "export const body = { version: '1', implementation: value };"
                ]
                    .join('\n')
            );
            const input = request(directory, []);
            const prepared = await prepareImplementation(input);
            scope.assert.equal(prepared.graph.modules.length, 2);
            scope.assert.equal(structuredClone(prepared).graph.build, prepared.graph.build);
            await writeFile(join(directory, 'value.mjs'), 'export const value = 99;');
            await scope.assert.rejects(async function admitDrift() {
                await withPreparedImplementation(
                    { ...input, prepared, parseImplementation: z.number().parse },
                    async function use(implementation) {
                        return implementation;
                    }
                );
            }, { message: 'Implementation graph changed; prepare and collect a new run.' });
        });
        return scope.assert.collect();
    }),
    test(
        'delivers a fresh build after dependency changes without reusing old exports',
        async function (scope) {
            await fixture(scope.signal, async function check(directory) {
                await writeFile(join(directory, 'value.mjs'), 'export const value = 42;');
                await writeFile(
                    join(directory, 'body.mjs'),
                    [
                        "import { value } from './value.mjs';",
                        "export const body = { version: '1', implementation: value };"
                    ]
                        .join('\n')
                );
                const input = request(directory, []);
                async function execute(): Promise<number> {
                    const prepared = await prepareImplementation(input);
                    return await withPreparedImplementation(
                        { ...input, prepared, parseImplementation: z.number().parse },
                        async function use(value) {
                            return value;
                        }
                    );
                }
                scope.assert.equal(await execute(), 42);
                await writeFile(join(directory, 'value.mjs'), 'export const value = 99;');
                scope.assert.equal(await execute(), 99);
            });
            return scope.assert.collect();
        }
    ),
    test(
        'allows declared computed imports and blocks undeclared modules before evaluation',
        async function (scope) {
            await fixture(scope.signal, async function check(directory) {
                await writeFile(join(directory, 'value.mjs'), 'export const value = 42;');
                await writeFile(
                    join(directory, 'body.mjs'),
                    [
                        "export const body = { version: '1', implementation: async function loadValue() {",
                        "const name = 'value'; return (await import('./' + name + '.mjs')).value;",
                        '} };'
                    ]
                        .join('\n')
                );
                const input = request(directory, [ 'value.mjs' ]);
                const parseImplementation = z
                    .custom<() => Promise<number>>(function callable(value) {
                        return typeof value === 'function';
                    })
                    .parse;
                const prepared = await prepareImplementation(input);
                scope.assert.equal(
                    await withPreparedImplementation(
                        { ...input, prepared, parseImplementation },
                        async function use(load) {
                            return await load();
                        }
                    ),
                    42
                );
                const undeclared = request(directory, []);
                const unpreparedTarget = await prepareImplementation(undeclared);
                await scope.assert.rejects(async function outsideGraph() {
                    await withPreparedImplementation(
                        { ...undeclared, prepared: unpreparedTarget, parseImplementation },
                        async function use(load) {
                            return await load();
                        }
                    );
                }, { message: 'Implementation import is outside the frozen graph: ./value.mjs' });
            });
            return scope.assert.collect();
        }
    ),
    test('keeps computed imports valid through nested admissions of the same build', async function (scope) {
        await fixture(scope.signal, async function check(directory) {
            await writeFile(join(directory, 'value.mjs'), 'export const value = 42;');
            await writeFile(
                join(directory, 'body.mjs'),
                [
                    "export const body = { version: '1', implementation: async function loadValue() {",
                    "const name = 'value'; return (await import('./' + name + '.mjs')).value;",
                    '} };'
                ]
                    .join('\n')
            );
            const input = request(directory, [ 'value.mjs' ]);
            const prepared = await prepareImplementation(input);
            const parseImplementation = z
                .custom<() => Promise<number>>(function callable(value) {
                    return typeof value === 'function';
                })
                .parse;
            const admission = { ...input, prepared, parseImplementation };
            const result = await withPreparedImplementation(admission, async function nested() {
                return await withPreparedImplementation(admission, async function invoke(load) {
                    return await load();
                });
            });
            scope.assert.equal(result, 42);
        });
        return scope.assert.collect();
    }),
    test('loads the actual namespace without invoking its then export', async function (scope) {
        await fixture(scope.signal, async function check(directory) {
            await writeFile(
                join(directory, 'body.mjs'),
                [
                    "export const body = {version:'1',implementation:42};",
                    "export function then() { throw new Error('then export was called'); }"
                ]
                    .join('\n')
            );
            const input = request(directory, []);
            const prepared = await prepareImplementation(input);
            const value = await withPreparedImplementation(
                { ...input, prepared, parseImplementation: z.number().parse },
                async function use(implementation) {
                    return implementation;
                }
            );
            scope.assert.equal(value, 42);
        });
        return scope.assert.collect();
    }),
    test('retains external source-map identity and detects map-only changes', async function (scope) {
        await fixture(scope.signal, async function check(directory) {
            await writeFile(
                join(directory, 'body.mjs'),
                "export const body = { version: '1', implementation: 42 };\n//# sourceMappingURL=body.map\n"
            );
            const map = { version: 3, sources: [ 'original.ts' ], mappings: 'AAAA' };
            await writeFile(join(directory, 'body.map'), JSON.stringify(map));
            const input = request(directory, []);
            const first = await prepareImplementation(input);
            await writeFile(join(directory, 'body.map'), JSON.stringify({ ...map, mappings: '' }));
            const second = await prepareImplementation(input);
            scope.assert.equal(first.graph.build === second.graph.build, false);
            scope.assert.equal(first.graph.modules[0]?.sourceMap?.source, JSON.stringify(map));
            scope.assert.equal(
                await readFile(join(directory, 'body.mjs'), 'utf8'),
                "export const body = { version: '1', implementation: 42 };\n//# sourceMappingURL=body.map\n"
            );
        });
        return scope.assert.collect();
    })
]);
