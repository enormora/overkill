import { table, suite, test } from '@overkill-dev/test';

import {
    memoryImplementationGraph,
    memoryImplementationModule,
    implementationFacts,
    mainImplementationUrl,
    dependencyImplementationUrl
} from '../../test-support/memory-implementation-graph.ts';
import { moduleLoadingRuntime } from '../../test-support/module-loading-runtime.ts';
import { createModuleLoading } from '../../module-delivery.ts';
import {
    assertImplementationGraph,
    deliverImplementationGraph,
    prepareImplementationGraph,
    verifyImplementationGraph
} from '../../implementation-graph.ts';

const main = memoryImplementationModule(mainImplementationUrl, {
    './dependency.ts': dependencyImplementationUrl,
    path: 'node:path'
});
const dependency = memoryImplementationModule(dependencyImplementationUrl, {});
export const testNode = suite('implementation graph preparation policy', [
    test(
        'freezes and verifies builtin-only graphs without reading project files',
        async function (scope) {
            const facts = {
                ...implementationFacts,
                module: { moduleUrl: 'node:fs', exportName: 'readFile' },
                dynamicModules: [ { moduleUrl: 'node:path', exportName: 'resolve' }, {
                    moduleUrl: 'node:buffer',
                    exportName: 'Buffer'
                } ]
            };
            const graph = await prepareImplementationGraph([ facts ]);
            scope.assert.deepEqual(graph.modules, []);
            scope.assert.deepEqual(graph.builtins, [ 'node:buffer', 'node:fs', 'node:path' ]);
            await verifyImplementationGraph(graph, [ facts ]);
            await scope.assert.rejects(async function () {
                await verifyImplementationGraph({ ...graph, builtins: [] }, [ facts ]);
            }, { message: 'Implementation graph changed; prepare and collect a new run.' });
            return scope.assert.collect();
        }
    ),
    table({
        title: 'rejects unsupported native graph entries',
        cases: [
            'https://example.com/source.ts',
            'file:///project/source.ts?query',
            'file:///project/source.ts#fragment'
        ] as const,
        caseTitle(url) {
            return url;
        },
        async test(scope) {
            const url = scope.parameters;

            await scope.assert.rejects(async function () {
                await prepareImplementationGraph([ {
                    ...implementationFacts,
                    module: { moduleUrl: url, exportName: 'body' }
                } ]);
            }, { message: `Unsupported native implementation URL: ${url}` });
            return scope.assert.collect();
        }
    }),

    test(
        'collects and sorts the transitive graph while preserving canonical entries',
        async function (scope) {
            const fixture = memoryImplementationGraph([ main, dependency ]);
            const facts = {
                ...implementationFacts,
                module: { ...implementationFacts.module, moduleUrl: 'file:///alias/main.ts' }
            };
            const graph = await fixture.preparation.prepare([ facts ]);
            scope.assert.deepEqual(
                graph.modules.map(function (module) {
                    return module.url;
                }),
                [ dependencyImplementationUrl, mainImplementationUrl ]
            );
            scope.assert.deepEqual(graph.builtins, [ 'node:path' ]);
            scope.assert.deepEqual(graph.entries, { 'file:///alias/main.ts': mainImplementationUrl });
            scope.assert.equal(graph.build.length, 64);
            scope.assert.true(Object.isFrozen(graph));
            return scope.assert.collect();
        }
    ),
    test(
        'reads each module once across shared roots and repeated preparation',
        async function (scope) {
            const fixture = memoryImplementationGraph([ main, dependency ]);
            const first = await fixture.preparation.prepare([ implementationFacts, implementationFacts ]);
            scope.assert.deepEqual(await fixture.preparation.prepare([ implementationFacts ]), first);
            scope.assert.equal(
                fixture
                    .calls
                    .filter(function (call) {
                        return call.startsWith('read:');
                    })
                    .length,
                2
            );
            return scope.assert.collect();
        }
    ),
    test(
        'terminates cyclic dependency traversal without duplicating modules',
        async function (scope) {
            const fixture = memoryImplementationGraph([ main, {
                ...dependency,
                dependencies: { './main.ts': mainImplementationUrl }
            } ]);
            const graph = await fixture.preparation.prepare([ implementationFacts ]);
            scope.assert.equal(graph.modules.length, 2);
            return scope.assert.collect();
        }
    ),
    test('collects explicitly declared dynamic modules', async function (scope) {
        const fixture = memoryImplementationGraph([ dependency ]);
        const graph = await fixture.preparation.prepare([ {
            ...implementationFacts,
            module: { moduleUrl: 'node:path', exportName: 'join' },
            dynamicModules: [ { moduleUrl: dependencyImplementationUrl, exportName: 'value' } ]
        } ]);
        scope.assert.deepEqual(graph.modules, [ dependency ]);
        scope.assert.deepEqual(graph.builtins, [ 'node:path' ]);
        return scope.assert.collect();
    }),
    test('rejects unsupported browser realms before reading modules', async function (scope) {
        const fixture = memoryImplementationGraph([]);
        await scope.assert.rejects(async function () {
            await fixture.preparation.prepare([ { ...implementationFacts, realm: 'browser' } ]);
        }, { message: 'The native implementation loader supports the host realm only.' });
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    test(
        'retains failed source reads consistently within a preparation session',
        async function (scope) {
            const fixture = memoryImplementationGraph([]);
            await scope.assert.rejects(async function () {
                await fixture.preparation.prepare([ implementationFacts ]);
            }, { message: `Unknown implementation module: ${mainImplementationUrl}` });
            await scope.assert.rejects(async function () {
                await fixture.preparation.prepare([ implementationFacts ]);
            }, { message: `Unknown implementation module: ${mainImplementationUrl}` });
            scope.assert.equal(
                fixture
                    .calls
                    .filter(function (call) {
                        return call.startsWith('read:');
                    })
                    .length,
                1
            );
            return scope.assert.collect();
        }
    ),
    test('rejects changes to previously frozen graph identity', async function (scope) {
        const fixture = memoryImplementationGraph([ main, dependency ]);
        const graph = await fixture.preparation.prepare([ implementationFacts ]);
        assertImplementationGraph(graph, graph);
        scope.assert.throws(function () {
            assertImplementationGraph(graph, { ...graph, entries: {} });
        }, { message: 'Implementation graph changed; prepare and collect a new run.' });
        return scope.assert.collect();
    }),
    test('delivers only declared canonical graph entries', async function (scope) {
        const fixture = memoryImplementationGraph([ main, dependency ]);
        const graph = await fixture.preparation.prepare([ implementationFacts ]);
        const delivery = moduleLoadingRuntime();
        const namespace = await deliverImplementationGraph(graph, async function (load) {
            return await load(mainImplementationUrl);
        }, createModuleLoading(delivery.runtime).withModuleDelivery);
        scope.assert.equal(namespace.namespace, delivery.namespace);
        await scope.assert.rejects(async function () {
            await deliverImplementationGraph(graph, async function (load) {
                return await load('file:///outside.ts');
            }, createModuleLoading(delivery.runtime).withModuleDelivery);
        }, { message: 'Implementation entry is outside the frozen graph.' });
        return scope.assert.collect();
    }),
    test('rejects forged graphs before invoking module delivery', async function (scope) {
        const fixture = memoryImplementationGraph([ main, dependency ]);
        const graph = await fixture.preparation.prepare([ implementationFacts ]);
        const delivery = moduleLoadingRuntime();
        await scope.assert.rejects(async function () {
            await deliverImplementationGraph({ ...graph, build: 'forged' }, async function () {
                return 42;
            }, createModuleLoading(delivery.runtime).withModuleDelivery);
        }, { message: 'Invalid implementation graph identity.' });
        scope.assert.deepEqual(delivery.imports, []);
        return scope.assert.collect();
    })
]);
