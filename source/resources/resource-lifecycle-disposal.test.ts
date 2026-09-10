import { createSuite, createTestCase, type TestNode, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    type AnyResourceDefinition,
    defineResource,
    defineRuntime,
    type EmptyResourceDependencies,
    type ResourceDefinition,
    type RuntimeDefinition
} from './resources.ts';
import { ResourceLifecycleError, startRuntime, type StartRuntimeRequest } from './runtime-lifecycle.ts';

type EventLog = {
    readonly add: (...events: readonly string[]) => void;
    readonly values: () => readonly string[];
};
type DisposableResource = ResourceDefinition<'resource', string, EmptyResourceDependencies>;
type ChildResource = ResourceDefinition<'child', string, EmptyResourceDependencies>;
type ParentDependencies = { readonly child: ChildResource; };
type ParentResource = ResourceDefinition<'parent', string, ParentDependencies>;
type RuntimeRequest = StartRuntimeRequest<RuntimeDefinition>;
type GraphFailure = {
    readonly phase: string;
    readonly resourceName: string;
};
type LifecycleFailure = GraphFailure & {
    readonly cause: unknown;
};
type DependencyReadFailureScenario = {
    readonly dependencyError: Error;
    readonly runtime: RuntimeDefinition;
};

function createEventLog(): EventLog {
    const events: string[] = [];

    return {
        add(...newEvents) {
            events.push(...newEvents);
        },
        values() {
            return Array.from(events);
        }
    };
}

function testSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function malformedDescriptor(): unknown {
    return {};
}

function invalidRuntimeRequest(): RuntimeRequest {
    const runtime = malformedDescriptor() as RuntimeDefinition;

    return {
        runtime,
        signal: testSignal()
    };
}

function invalidResourceRuntimeRequest(): RuntimeRequest {
    const resource = malformedDescriptor() as AnyResourceDefinition;

    return {
        runtime: defineRuntime({
            name: 'invalid-resource',
            dimensions: {},
            resources: { resource },
            requirements: []
        }),
        signal: testSignal()
    };
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected promise rejection.');
}

function assertLifecycleError(error: unknown): ResourceLifecycleError {
    if (!(error instanceof ResourceLifecycleError)) {
        throw new Error('Expected ResourceLifecycleError.');
    }

    return error;
}

function graphFailureSummary(failure: GraphFailure): readonly string[] {
    return [ failure.phase, failure.resourceName ];
}

function lifecycleFailureSummary(failure: LifecycleFailure): readonly unknown[] {
    return [ failure.phase, failure.resourceName, failure.cause ];
}

function disposableResource(events: EventLog): DisposableResource {
    return defineResource({
        name: 'resource',
        scope: 'per-case',
        requirements: [],
        acquire(): string {
            events.add('acquire');

            return 'handle';
        },
        dispose() {
            events.add('dispose');
        }
    });
}

function nullDisposeResource(): DisposableResource {
    return defineResource({
        name: 'resource',
        scope: 'per-case',
        requirements: [],
        acquire() {
            return 'handle';
        },
        dispose: null
    });
}

function nullDisposeRuntime(): RuntimeDefinition {
    return defineRuntime({
        name: 'null-dispose',
        dimensions: {},
        resources: { resource: nullDisposeResource() },
        requirements: []
    });
}

function dependencyReadFailureScenario(): DependencyReadFailureScenario {
    const dependencyError = new Error('dependency read failed');
    const child: ChildResource = defineResource({
        name: 'child',
        scope: 'per-case',
        requirements: [],
        acquire() {
            return 'child';
        },
        dispose: null
    });
    let reads = 0;
    const dependencies = {
        get child(): ChildResource {
            reads += 1;

            if (reads > 1) {
                throw dependencyError;
            }

            return child;
        }
    };
    const parent: ParentResource = defineResource({
        name: 'parent',
        scope: 'per-case',
        requirements: [],
        dependencies,
        acquire() {
            return 'parent';
        },
        dispose: null
    });
    const runtime = defineRuntime({
        name: 'dependency-read-failure',
        dimensions: {},
        resources: { parent },
        requirements: []
    });

    return { dependencyError, runtime };
}

async function assertAsyncDispose(scope: TestScope): Promise<void> {
    const events = createEventLog();
    const runtime = defineRuntime({
        name: 'async-dispose',
        dimensions: {},
        resources: { resource: disposableResource(events) },
        requirements: []
    });

    await using session = await startRuntime({ runtime, signal: testSignal() });

    scope.assert.equal(session.context.resource, 'handle');
    scope.assert.deepEqual(events.values(), [ 'acquire' ]);
}

async function assertNullDispose(scope: TestScope): Promise<void> {
    const session = await startRuntime({ runtime: nullDisposeRuntime(), signal: testSignal() });

    await session.disposeOnce({ signal: testSignal() });
    scope.assert.equal(session.context.resource, 'handle');
}

async function assertInvalidDescriptors(scope: TestScope): Promise<void> {
    const invalidRuntimeError = assertLifecycleError(
        await rejectedValue(startRuntime(invalidRuntimeRequest()))
    );
    const invalidResourceError = assertLifecycleError(
        await rejectedValue(startRuntime(invalidResourceRuntimeRequest()))
    );

    scope.assert.deepEqual(invalidRuntimeError.failures().map(graphFailureSummary), [ [ 'graph', 'runtime' ] ]);
    scope.assert.deepEqual(invalidResourceError.failures().map(graphFailureSummary), [ [ 'graph', 'resource' ] ]);
}

async function assertDependencyReadFailure(scope: TestScope): Promise<void> {
    const scenario = dependencyReadFailureScenario();
    const error = assertLifecycleError(
        await rejectedValue(startRuntime({ runtime: scenario.runtime, signal: testSignal() }))
    );

    scope.assert.deepEqual(error.failures().map(lifecycleFailureSummary), [
        [ 'acquire', 'runtime', scenario.dependencyError ]
    ]);
}

function disposalTestCase(
    title: string,
    assertion: (scope: TestScope) => Promise<void>
): TestNode {
    return createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        title,
        annotations: {},
        controls: {},
        async body(scope: TestScope) {
            await assertion(scope);

            return scope.assert.collect();
        }
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/resource-lifecycle-disposal.test.ts',
    annotations: {},
    controls: {},
    children: [
        disposalTestCase('runtime session supports async disposal', assertAsyncDispose),
        disposalTestCase('runtime session skips resources without dispose callbacks', assertNullDispose),
        disposalTestCase('startRuntime rejects malformed descriptors', assertInvalidDescriptors),
        disposalTestCase('startRuntime wraps dependency read failures', assertDependencyReadFailure)
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
