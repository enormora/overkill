import { CaseRunnerError } from '../engine/run-result.ts';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { resourceLifecycleError } from '../resources/resource-lifecycle-error.ts';
import {
    runtimeAsyncDisposeSymbol,
    type ResourceSession
} from '../resources/resource-session.ts';
import {
    defineResource,
    defineRuntime,
    type ResourceContext,
    type RuntimeResourceMap
} from '../resources/resources.ts';
import {
    combinedResourceEntries,
    composedResourceSession,
    directResourceEntries,
    lifecycleMessages,
    resourceMapFromEntries,
    resourceContextForStep,
    runtimeContextForStep,
    stepRuntimeGraphs,
    type ComposedResourceSession
} from './resource-lifecycle-composition.ts';
import {
    resourceWrapperErrorFromUnknown,
    resourceWrapperLifecycleError
} from './resource-lifecycle-error.ts';
import {
    activeManagedLifecycle,
    currentLifecycleCase
} from './resource-lifecycle-state.ts';
import { managedResourceSession } from './resource-lifecycle-managed-session.ts';

const databaseResource = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [],
    acquire() {
        return 'database';
    },
    dispose: null
});
const resources = Object.freeze({ database: databaseResource });
const runtime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources,
    requirements: []
});
const runtimeResourceKey = JSON.stringify([ 'api', null, [] ]);
const runtimeDatabaseResourceKey = `runtime:${runtimeResourceKey}:database`;
const steps = [
    { kind: 'resources', resources },
    { kind: 'runtime', runtime }
] as const;

type TrackedResourceSession = {
    readonly isDisposed: () => boolean;
    readonly session: ResourceSession<RuntimeResourceMap>;
};
type PatchedReflectGet = (...parameters: Parameters<typeof Reflect.get>) => unknown;
type RestoreGlobal = () => void;

function disposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function trackedResourceSession(): TrackedResourceSession {
    let disposed = false;
    const sessionContext: ResourceContext<RuntimeResourceMap> = Object.freeze({
        'resource:database': 'direct handle',
        [runtimeDatabaseResourceKey]: 'runtime handle'
    });
    const session = {
        context: sessionContext,
        async disposeOnce() {
            disposed = true;
        }
    };

    Object.defineProperty(session, runtimeAsyncDisposeSymbol(), {
        value: async function disposeResourceWrapperCompositionSession(): Promise<void> {
            disposed = true;
        }
    });

    return {
        isDisposed() {
            return disposed;
        },
        session: Object.freeze(session) as unknown as ResourceSession<RuntimeResourceMap>
    };
}

function replaceObjectHasOwn(hasOwn: typeof Object.hasOwn): RestoreGlobal {
    const originalHasOwn = Object.hasOwn;

    Object.defineProperty(Object, 'hasOwn', {
        configurable: true,
        value: hasOwn
    });

    return function restoreObjectHasOwn() {
        Object.defineProperty(Object, 'hasOwn', {
            configurable: true,
            value: originalHasOwn
        });
    };
}

function replaceReflectGet(reflectGet: PatchedReflectGet): RestoreGlobal {
    const originalReflectGet = Reflect.get;

    Object.defineProperty(Reflect, 'get', {
        configurable: true,
        value: reflectGet
    });

    return function restoreReflectGet() {
        Object.defineProperty(Reflect, 'get', {
            configurable: true,
            value: originalReflectGet
        });
    };
}

function captureThrown(run: () => void): unknown {
    try {
        run();

        return null;
    } catch (error: unknown) {
        return error;
    }
}

function invalidResourceContextConstructionError(): unknown {
    const restore = replaceObjectHasOwn(function hideOwnProperties() {
        return false;
    });

    try {
        return captureThrown(function readInvalidResourceContext() {
            resourceContextForStep(resources, Object.freeze({ database: 'database handle' }));
        });
    } finally {
        restore();
    }
}

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/resource-lifecycle-composition.test.ts',
    children: [
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrapper composition maps mixed direct and runtime steps',
            async body(scope: TestScope) {
                const trackedSession = trackedResourceSession();
                const composed = composedResourceSession(
                    resourceMapFromEntries(directResourceEntries(steps)),
                    stepRuntimeGraphs(steps),
                    trackedSession.session
                );

                scope.assert.deepEqual(Object.keys(combinedResourceEntries(steps)), [
                    'resource:database',
                    runtimeDatabaseResourceKey
                ]);
                scope.assert.equal(
                    resourceContextForStep(resources, composed.directResources).database,
                    'direct handle'
                );
                scope.assert.equal(runtimeContextForStep(runtime, composed).database, 'runtime handle');
                await composed.disposeOnce({ signal: disposalSignal() });
                scope.assert.equal(trackedSession.isDisposed(), true);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrapper lifecycle messages follow direct resource presence',
            body(scope: TestScope) {
                scope.assert.deepEqual(lifecycleMessages(steps), {
                    acquisitionFailure: 'Resource acquisition failed.',
                    disposalFailure: 'Resource disposal failed.'
                });
                scope.assert.deepEqual(lifecycleMessages([ { kind: 'runtime', runtime } ]), {
                    acquisitionFailure: 'Runtime resource acquisition failed.',
                    disposalFailure: 'Runtime resource disposal failed.'
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrapper composition rejects invalid resource context construction',
            body(scope: TestScope) {
                const thrown = invalidResourceContextConstructionError();

                scope.assert.equal(thrown instanceof CaseRunnerError, true);
                scope.assert.equal(thrown instanceof Error ? thrown.message : '', 'Resource scope composition failed.');

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrapper composition rejects malformed composed sessions',
            body(scope: TestScope) {
                const emptyContext = Object.freeze({}) as ResourceContext<RuntimeResourceMap>;
                const session: ComposedResourceSession = Object.freeze({
                    directResources: emptyContext,
                    async disposeOnce() {
                        return undefined;
                    },
                    runtimeContexts: new Map()
                });
                const incompleteSession: ComposedResourceSession = Object.freeze({
                    directResources: emptyContext,
                    async disposeOnce() {
                        return undefined;
                    },
                    runtimeContexts: new Map([ [ runtime, emptyContext ] ])
                });

                scope.assert.throws(function readMissingRuntimeContext() {
                    runtimeContextForStep(runtime, session);
                }, { message: 'Runtime scope composition failed.' });
                scope.assert.throws(function readIncompleteRuntimeContext() {
                    runtimeContextForStep(runtime, incompleteSession);
                }, { message: 'Runtime scope composition failed.' });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'managed resource sessions reject invalid async disposal support',
            body(scope: TestScope) {
                const originalReflectGet = Reflect.get;
                const restore = replaceReflectGet(function hideAsyncDisposeSymbol(...parameters) {
                    const [ target, propertyKey, receiver ] = parameters;

                    if (target === Symbol && propertyKey === 'asyncDispose') {
                        return undefined;
                    }

                    return receiver === undefined
                        ? originalReflectGet(target, propertyKey)
                        : originalReflectGet(target, propertyKey, receiver);
                });

                try {
                    scope.assert.throws(function createInvalidManagedSession() {
                        managedResourceSession(resources, new Map());
                    }, { message: 'Runtime does not provide Symbol.asyncDispose.' });
                } finally {
                    restore();
                }

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'managed resource sessions reject invalid session construction',
            body(scope: TestScope) {
                const originalReflectGet = Reflect.get;
                const restore = replaceReflectGet(function hideSessionDisposeOnce(...parameters) {
                    const [ target, propertyKey, receiver ] = parameters;

                    if (target !== Symbol && propertyKey === 'disposeOnce') {
                        return undefined;
                    }

                    return receiver === undefined
                        ? originalReflectGet(target, propertyKey)
                        : originalReflectGet(target, propertyKey, receiver);
                });

                try {
                    scope.assert.throws(function createInvalidManagedSession() {
                        managedResourceSession(resources, new Map());
                    }, { message: 'Resource scope composition failed.' });
                } finally {
                    restore();
                }

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'managed resource sessions expose managed handles without disposal',
            async body(scope: TestScope) {
                const handles = new Map([ [ databaseResource, 'database handle' ] ]);
                const session = managedResourceSession(resources, handles);
                const dispose: unknown = Reflect.get(session, runtimeAsyncDisposeSymbol());

                scope.assert.equal(session.context.database, 'database handle');
                await session.disposeOnce({ signal: disposalSignal() });
                scope.assert.equal(typeof dispose, 'function');
                if (typeof dispose !== 'function') {
                    throw new TypeError('Managed session is missing async disposal.');
                }
                await Reflect.apply(dispose, session, []);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrapper lifecycle context defaults to inactive',
            body(scope: TestScope) {
                scope.assert.equal(activeManagedLifecycle(), null);
                scope.assert.equal(currentLifecycleCase(), null);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrapper lifecycle errors preserve causes',
            body(scope: TestScope) {
                const lifecycleCause = new Error('root cause');
                const lifecycleError = resourceLifecycleError('Lifecycle failed.', [
                    { cause: lifecycleCause, phase: 'acquire', resourceName: 'database' }
                ], lifecycleCause);
                const wrappedLifecycleError = resourceWrapperLifecycleError('Fixture failed.', lifecycleError);
                const runnerError = new CaseRunnerError('Already wrapped.', {
                    cause: lifecycleCause,
                    subtype: 'fixture'
                });
                const ordinaryCause = new Error('ordinary cause');

                scope.assert.equal(wrappedLifecycleError.cause, lifecycleCause);
                scope.assert.equal(resourceWrapperErrorFromUnknown('Fixture failed.', runnerError), runnerError);
                scope.assert.equal(
                    resourceWrapperErrorFromUnknown('Fixture failed.', lifecycleError).cause,
                    lifecycleCause
                );
                scope.assert.equal(
                    resourceWrapperErrorFromUnknown('Fixture failed.', ordinaryCause).cause,
                    ordinaryCause
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
