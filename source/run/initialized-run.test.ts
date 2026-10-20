import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { orchestrator, type RunOrchestrator } from '../packages/run/run.entry-point.ts';
import { collectedRunCommand } from '../test-support/collected-run-fixtures.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import { createCurrentProcessRunOrchestrator } from './current-process-run-orchestrator.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { loadRunEngineModule, loadRunTestModules, runDiscovery } from './node-run-dependencies.entry-point.ts';
import { startSupervisedChild, startWorkerPoolHost } from './node-child-process-starters.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const missingEngineUrl = new URL('./missing-engine.mjs', import.meta.url);

type ObservedOrchestrator = {
    readonly loads: { readonly engines: number; readonly modules: number; };
    readonly orchestrator: RunOrchestrator;
};

function observedOrchestrator(): ObservedOrchestrator {
    const loads = { engines: 0, modules: 0 };
    return {
        loads,
        orchestrator: createCurrentProcessRunOrchestrator(defaultRunEngine, {
            discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
            async loadRunEngineModule(engine) {
                loads.engines += 1;
                return await loadRunEngineModule(engine);
            },
            async loadRunTestModules(files, engine) {
                loads.modules += 1;
                return await loadRunTestModules(files, engine);
            },
            startSupervisedChild,
            startWorkerPoolHost
        })
    };
}

function rejectedCollectionOrchestrator(pendingImport: Promise<void>): RunOrchestrator {
    return createCurrentProcessRunOrchestrator(defaultRunEngine, {
        discoverRunFilesWithProjectRoot: runDiscovery.discoverRunFilesWithProjectRoot,
        loadRunEngineModule,
        async loadRunTestModules(files, engine) {
            const modules = await loadRunTestModules(files, engine);
            process.emit('unhandledRejection', new Error('collection hook sentinel'), Promise.resolve());
            await pendingImport;
            return modules;
        },
        startSupervisedChild,
        startWorkerPoolHost
    });
}

export const testNode = createSuite({
    ...metadata,
    title: 'runner initialization',
    children: [
        createTestCase({
            ...metadata,
            title: 'collection rejects process failures while an import is pending and stops native policy observers',
            async body(scope) {
                const pending = Promise.withResolvers<undefined>();
                scope.cleanup(function releasePendingImport() {
                    pending.resolve(undefined);
                });
                const ready = await rejectedCollectionOrchestrator(pending.promise).initialize(collectedRunCommand());
                const listeners = process.listenerCount('newListener');
                await scope.assert.rejects(async function collectRejectedImport() {
                    await ready.collect();
                }, { message: 'Unhandled rejection: collection hook sentinel' });
                pending.resolve(undefined);
                scope.assert.equal(process.listenerCount('newListener'), listeners);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'initialization imports nothing and collection and execution retain one load',
            async body(scope) {
                const observed = observedOrchestrator();
                const ready = await observed.orchestrator.initialize(collectedRunCommand());
                const initialLoads = { ...observed.loads };
                const [ collected, concurrentCollection ] = await Promise.all([ ready.collect(), ready.collect() ]);
                await collected.run({ selection: { kind: 'all' } });
                await collected.run({ selection: { kind: 'all' } });
                scope.assert.deepEqual({
                    initialLoads,
                    loads: observed.loads,
                    sameConcurrentHandle: collected === concurrentCollection,
                    sameLaterHandle: await ready.collect() === collected
                }, {
                    initialLoads: { engines: 0, modules: 0 },
                    loads: { engines: 0, modules: 1 },
                    sameConcurrentHandle: true,
                    sameLaterHandle: true
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'initialization snapshots paths and filters before caller mutation',
            async body(scope) {
                const command = collectedRunCommand();
                const paths = Array.from(command.request.paths);
                const selection = {
                    kind: 'filter' as const,
                    filter: { kind: 'equals' as const, field: 'title' as const, value: 'first' }
                };
                const ready = await orchestrator.initialize({
                    ...command,
                    request: { ...command.request, paths, selection }
                });
                paths.length = 0;
                selection.filter.value = 'second';
                const collected = await ready.collect();
                scope.assert.deepEqual(
                    collected.facts.cases.map(function caseTitle(testCase) {
                        return testCase.id.title;
                    }),
                    [ 'first' ]
                );
                scope.assert.equal(collected.facts.reproducibility.seed, '42');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'unsupported process models reject before any engine or test import',
            async body(scope) {
                const observed = observedOrchestrator();
                const command = collectedRunCommand();
                await scope.assert.rejects(async function initializeSupervisedRun() {
                    await observed.orchestrator.initialize({
                        ...command,
                        config: defaultRunConfig({
                            profiles: {
                                microtest: defaultMicrotestProfile({
                                    execution: { processModel: 'supervised-process' }
                                })
                            }
                        })
                    });
                }, { message: 'Collected execution requires an in-process profile.' });
                scope.assert.deepEqual({ ...observed.loads }, { engines: 0, modules: 0 });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'custom engine loading is deferred and a failed collection is not retried',
            async body(scope) {
                const observed = observedOrchestrator();
                const ready = await observed.orchestrator.initialize({
                    ...collectedRunCommand(),
                    engine: {
                        kind: 'module',
                        moduleUrl: missingEngineUrl.href,
                        exportName: 'engine',
                        exportKind: 'value'
                    }
                });
                scope.assert.deepEqual({ ...observed.loads }, { engines: 0, modules: 0 });
                const failure = ready.collect();
                await scope.assert.rejects(async function collectMissingEngine() {
                    await failure;
                }, { message: 'Failed to load custom engine module.' });
                await scope.assert.rejects(async function repeatFailedCollection() {
                    await ready.collect();
                }, { message: 'Failed to load custom engine module.' });
                scope.assert.deepEqual({ ...observed.loads }, { engines: 1, modules: 0 });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'collection policy failures produce no executable handle and stop observations',
            async body(scope) {
                const command = collectedRunCommand();
                const ready = await orchestrator.initialize({
                    ...command,
                    request: {
                        ...command.request,
                        paths: [ 'source/integration-tests/run/fixtures/collected-policy.test.ts' ]
                    }
                });
                const listeners = process.listenerCount('newListener');
                await scope.assert.rejects(async function collectForbiddenConsole() {
                    await ready.collect();
                }, {
                    message: 'Test collection violated runtime policy.'
                });
                scope.assert.equal(process.listenerCount('newListener'), listeners);
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
