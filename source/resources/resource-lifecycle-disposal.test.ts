import {
    type CompositeAssertionReference,
    type CompositeAssertionReturn,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { defineMacro, test, suite } from '@overkill-dev/test';

import {
    type AnyResourceDefinition,
    defineResource,
    defineRuntime,
    type EmptyResourceDependencies,
    type ResourceDefinition,
    type RuntimeDefinition
} from './resources.ts';
import { ResourceLifecycleError } from './resource-lifecycle-error.ts';
import { startRuntime, type StartRuntimeRequest } from './runtime-lifecycle.ts';

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

const assertAsyncDispose = defineCompositeAssertion({
    name: 'async dispose',
    async assert(check) {
        const events = createEventLog();
        const runtime = defineRuntime({
            name: 'async-dispose',
            dimensions: {},
            resources: { resource: disposableResource(events) },
            requirements: []
        });
        await using session = await startRuntime({ runtime, signal: testSignal() });
        return check.group([
            check.equal(session.context.resource, 'handle'),
            check.deepEqual(events.values(), [ 'acquire' ])
        ]);
    }
});

const assertNullDispose = defineCompositeAssertion({
    name: 'null dispose',
    async assert(check) {
        const session = await startRuntime({ runtime: nullDisposeRuntime(), signal: testSignal() });
        await session.disposeOnce({ signal: testSignal() });
        return check.group([ check.equal(session.context.resource, 'handle') ]);
    }
});

const assertInvalidDescriptors = defineCompositeAssertion({
    name: 'invalid descriptors',
    async assert(check) {
        const invalidRuntimeError = assertLifecycleError(
            await rejectedValue(startRuntime(invalidRuntimeRequest()))
        );
        const invalidResourceError = assertLifecycleError(
            await rejectedValue(startRuntime(invalidResourceRuntimeRequest()))
        );
        return check.group([
            check.deepEqual(invalidRuntimeError.failures().map(graphFailureSummary), [ [ 'graph', 'runtime' ] ]),
            check.deepEqual(invalidResourceError.failures().map(graphFailureSummary), [ [ 'graph', 'resource' ] ])
        ]);
    }
});

const assertDependencyReadFailure = defineCompositeAssertion({
    name: 'dependency read failure',
    async assert(check) {
        const scenario = dependencyReadFailureScenario();
        const error = assertLifecycleError(
            await rejectedValue(startRuntime({ runtime: scenario.runtime, signal: testSignal() }))
        );
        return check.group([ check.deepEqual(error.failures().map(lifecycleFailureSummary), [
            [ 'acquire', 'runtime', scenario.dependencyError ]
        ]) ]);
    }
});

const disposalTestCase = defineMacro(
    function (title: string, assertion: CompositeAssertionReference<[], Promise<CompositeAssertionReturn<'assert'>>>) {
        return test({
            title,
            annotations: {},
            controls: {},
            async body(scope) {
                await scope.assert(assertion);

                return scope.assert.collect();
            }
        });
    }
);

export const testNode = suite('Resource lifecycle disposal', [
    disposalTestCase('runtime session supports async disposal', assertAsyncDispose),
    disposalTestCase('runtime session skips resources without dispose callbacks', assertNullDispose),
    disposalTestCase('startRuntime rejects malformed descriptors', assertInvalidDescriptors),
    disposalTestCase('startRuntime wraps dependency read failures', assertDependencyReadFailure)
]);
