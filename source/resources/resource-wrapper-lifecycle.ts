import { caseIdentityKey } from '../engine/identity.ts';
import type { TestRuntimePolicy } from '../engine/case-execution.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceProjectionContext,
    ResourceProjectionPayload,
    ResourceScope,
    RuntimeResourceMap as ResourceMap
} from './resources.ts';
import {
    assertResourceDependencyScopes,
    callableResourceDefinition,
    createResourceGraph,
    resourceEntries,
    type ResourceGraph
} from './resource-graph.ts';
import {
    combinedResourceEntries,
    composedResourceSession,
    directResourceEntries,
    resourceMapFromEntries,
    stepRuntimeGraphs,
    type ComposedResourceSession,
    type LifecycleMessages,
    type ResourceWrapperStep
} from './resource-wrapper-composition-core.ts';
import {
    currentLifecycleCase,
    runWithLifecycleCase,
    runWithManagedLifecycle,
    type ManagedLifecycleState,
    type ManagedRunnerError
} from './resource-wrapper-lifecycle-state.ts';
import {
    resourceWrapperErrorFromUnknown,
    resourceWrapperLifecycleError
} from './resource-wrapper-lifecycle-error.ts';
import { managedResourceSession } from './resource-wrapper-managed-session.ts';

type LifecycleBoundary = {
    readonly key: string;
    readonly scope: ResourceScope;
};

type ManagedResourceRecord = {
    readonly boundary: LifecycleBoundary;
    readonly dependencyContext: ResourceContext<ResourceMap>;
    readonly descriptor: AnyResourceDefinition;
    readonly exposedHandle: unknown;
    readonly ownerHandle: unknown;
};
type ManagedResourceAcquisition = Promise<ManagedResourceRecord>;
type ProjectedResourceDefinition = AnyResourceDefinition & {
    readonly deserializeHandle: (
        payload: ResourceProjectionPayload,
        context: ResourceProjectionContext<ResourceMap>
    ) => unknown;
    readonly serializeHandle: (
        handle: unknown,
        context: ResourceProjectionContext<ResourceMap>
    ) => ResourceProjectionPayload;
};
type ManagedLifecycleStores = {
    readonly deleteAcquisition: (boundaryKey: string) => void;
    readonly deleteRecord: (boundaryKey: string) => void;
    readonly existingAcquisition: (boundaryKey: string) => Promise<ManagedResourceRecord | null>;
    readonly existingRecord: (boundaryKey: string) => ManagedResourceRecord | undefined;
    readonly recordCaseError: (testCase: TestPlanCase, message: string, cause: unknown) => void;
    readonly remainingBoundaryUses: (boundaryKey: string) => number;
    readonly rememberAcquisition: (boundaryKey: string, acquisition: ManagedResourceAcquisition) => void;
    readonly rememberRecord: (boundaryKey: string, record: ManagedResourceRecord) => void;
    readonly takeCaseErrors: (testCase: TestPlanCase) => readonly ManagedRunnerError[];
    readonly takeRunErrors: () => readonly ManagedRunnerError[];
};

type ManagedResourceAcquirer = {
    readonly acquire: (
        resource: AnyResourceDefinition,
        testCase: TestPlanCase,
        signal: AbortSignal
    ) => Promise<ManagedResourceRecord>;
};

const resourceScopes: ReadonlySet<string> = new Set([
    'per-case',
    'per-file',
    'per-run',
    'per-suite',
    'shared-per-worker'
]);

function isResourceScope(scope: string): scope is ResourceScope {
    return resourceScopes.has(scope);
}

function isProjectionScalar(value: unknown): value is ResourceProjectionPayload {
    return value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number' && Number.isFinite(value);
}

function isProjectionObject(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProjectionPayload(value: unknown): value is ResourceProjectionPayload {
    if (isProjectionScalar(value)) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.every(isProjectionPayload);
    }

    return isProjectionObject(value) &&
        Object.values(value).every(isProjectionPayload);
}

function resourceHasProjection(resource: AnyResourceDefinition): resource is ProjectedResourceDefinition {
    return typeof resource.serializeHandle === 'function' &&
        typeof resource.deserializeHandle === 'function';
}

function projectedHandle(
    resource: AnyResourceDefinition,
    ownerHandle: unknown,
    dependencyContext: ResourceContext<ResourceMap>
): unknown {
    if (!resourceHasProjection(resource)) {
        return ownerHandle;
    }

    const context = { dependencies: dependencyContext };
    const payload = resource.serializeHandle(ownerHandle, context);

    if (!isProjectionPayload(payload)) {
        throw resourceWrapperLifecycleError(
            `Resource "${resource.name}" returned a non-JSON projection payload.`,
            payload
        );
    }

    return resource.deserializeHandle(payload, context);
}

function suiteBoundary(testCase: TestPlanCase): string {
    return JSON.stringify(testCase.id.suite);
}

function resourceBoundaryForCase(
    resourceName: string,
    scope: Extract<ResourceScope, 'per-case' | 'shared-per-worker'>,
    testCase: TestPlanCase
): LifecycleBoundary {
    return scope === 'shared-per-worker'
        ? { key: `worker:${resourceName}`, scope }
        : { key: `case:${caseIdentityKey(testCase.id)}:${resourceName}`, scope };
}

function resourceBoundary(
    resourceName: string,
    scope: ResourceScope,
    testCase: TestPlanCase
): LifecycleBoundary {
    const file = testCase.id.file ?? '<no-file>';

    if (scope === 'per-run') {
        return { key: `run:${resourceName}`, scope };
    }

    if (scope === 'per-file') {
        return { key: `file:${file}:${resourceName}`, scope };
    }

    if (scope === 'per-suite') {
        return { key: `suite:${file}:${suiteBoundary(testCase)}:${resourceName}`, scope };
    }

    return resourceBoundaryForCase(resourceName, scope, testCase);
}

function currentRunningCase(): TestPlanCase {
    const testCase = currentLifecycleCase();

    if (testCase === null) {
        throw resourceWrapperLifecycleError('Resource lifecycle is not attached to a running test case.', null);
    }

    return testCase;
}

function caseResourceBoundaries(testCase: TestPlanCase): readonly string[] {
    return Array.from(
        new Set(testCase.resourceAttachments.resourceGraph.flatMap(function toBoundary(resource) {
            return isResourceScope(resource.scope)
                ? [ resourceBoundary(resource.name, resource.scope, testCase).key ]
                : [];
        }))
    );
}

function initialBoundaryUseCounts(testCases: readonly TestPlanCase[]): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();

    for (const testCase of testCases) {
        for (const boundary of caseResourceBoundaries(testCase)) {
            counts.set(boundary, (counts.get(boundary) ?? 0) + 1);
        }
    }

    return counts;
}

function caseKey(testCase: TestPlanCase): string {
    return caseIdentityKey(testCase.id);
}

function mutableDependencyContext(): Record<string, unknown> {
    return {};
}

function createManagedStores(testCases: readonly TestPlanCase[]): ManagedLifecycleStores {
    const acquisitions = new Map<string, ManagedResourceAcquisition>();
    const boundaryUseCounts = new Map(initialBoundaryUseCounts(testCases));
    const errorsByCase = new Map<string, ManagedRunnerError[]>();
    const records = new Map<string, ManagedResourceRecord>();
    const runErrors: ManagedRunnerError[] = [];

    return {
        deleteAcquisition(boundaryKey) {
            acquisitions.delete(boundaryKey);
        },
        deleteRecord(boundaryKey) {
            records.delete(boundaryKey);
        },
        async existingAcquisition(boundaryKey) {
            return await (acquisitions.get(boundaryKey) ?? Promise.resolve(null));
        },
        existingRecord(boundaryKey) {
            return records.get(boundaryKey);
        },
        recordCaseError(testCase, message, cause) {
            const key = caseKey(testCase);
            const errors = errorsByCase.get(key) ?? [];

            errors.push(resourceWrapperLifecycleError(message, cause).runnerError(testCase.id));
            errorsByCase.set(key, errors);
        },
        remainingBoundaryUses(boundaryKey) {
            const remaining = (boundaryUseCounts.get(boundaryKey) ?? 0) - 1;

            boundaryUseCounts.set(boundaryKey, remaining);

            return remaining;
        },
        rememberAcquisition(boundaryKey, acquisition) {
            acquisitions.set(boundaryKey, acquisition);
        },
        rememberRecord(boundaryKey, record) {
            records.set(boundaryKey, record);
        },
        takeCaseErrors(testCase) {
            const key = caseKey(testCase);
            const errors = errorsByCase.get(key) ?? [];

            errorsByCase.delete(key);

            return errors;
        },
        takeRunErrors() {
            const errors = Array.from(runErrors);

            runErrors.length = 0;

            return errors;
        }
    };
}

function boundaryFor(resource: AnyResourceDefinition, testCase: TestPlanCase): LifecycleBoundary {
    return resourceBoundary(resource.name, resource.scope, testCase);
}

function assertCompatibleResource(
    stores: ManagedLifecycleStores,
    boundary: LifecycleBoundary,
    resource: AnyResourceDefinition
): void {
    const record = stores.existingRecord(boundary.key);

    if (record !== undefined && record.descriptor !== resource) {
        throw resourceWrapperLifecycleError(
            `Resource name "${resource.name}" is used by multiple descriptors in one lifecycle boundary.`,
            resource
        );
    }
}

function createManagedResourceAcquirer(stores: ManagedLifecycleStores): ManagedResourceAcquirer {
    let acquireResource: ManagedResourceAcquirer['acquire'] = async function acquireBeforeReady() {
        throw resourceWrapperLifecycleError('Resource lifecycle is not ready.', null);
    };

    async function acquireDependencyContext(
        resource: AnyResourceDefinition,
        testCase: TestPlanCase,
        signal: AbortSignal
    ): Promise<ResourceContext<ResourceMap>> {
        const context = mutableDependencyContext();

        await Promise.all(
            resourceEntries(resource.dependencies).map(async function acquireDependency([ key, dependency ]) {
                const record = await acquireResource(dependency, testCase, signal);

                context[key] = record.exposedHandle;
            })
        );

        return Object.freeze(context);
    }

    async function startResource(
        resource: AnyResourceDefinition,
        boundary: LifecycleBoundary,
        testCase: TestPlanCase,
        signal: AbortSignal
    ): Promise<ManagedResourceRecord> {
        const dependencyContext = await acquireDependencyContext(resource, testCase, signal);
        const ownerHandle = await callableResourceDefinition(resource).acquire({
            dependencies: dependencyContext,
            signal
        });
        const record = {
            boundary,
            dependencyContext,
            descriptor: resource,
            exposedHandle: projectedHandle(resource, ownerHandle, dependencyContext),
            ownerHandle
        };

        stores.rememberRecord(boundary.key, record);

        return record;
    }

    async function acquireNewResource(
        resource: AnyResourceDefinition,
        boundary: LifecycleBoundary,
        testCase: TestPlanCase,
        signal: AbortSignal
    ): Promise<ManagedResourceRecord> {
        const acquisition = startResource(resource, boundary, testCase, signal);

        stores.rememberAcquisition(boundary.key, acquisition);

        try {
            return await acquisition;
        } catch (error: unknown) {
            stores.deleteAcquisition(boundary.key);
            throw error;
        }
    }

    async function acquire(
        resource: AnyResourceDefinition,
        testCase: TestPlanCase,
        signal: AbortSignal
    ): Promise<ManagedResourceRecord> {
        const boundary = boundaryFor(resource, testCase);
        const existingRecord = stores.existingRecord(boundary.key);

        assertCompatibleResource(stores, boundary, resource);

        if (existingRecord !== undefined) {
            return existingRecord;
        }

        const existingAcquisition = await stores.existingAcquisition(boundary.key);

        return existingAcquisition ?? await acquireNewResource(resource, boundary, testCase, signal);
    }

    acquireResource = acquire;

    return { acquire };
}

async function disposeBoundary(
    stores: ManagedLifecycleStores,
    boundaryKey: string,
    signal: AbortSignal
): Promise<void> {
    const record = stores.existingRecord(boundaryKey);

    if (record === undefined) {
        return;
    }

    const { dispose } = callableResourceDefinition(record.descriptor);

    stores.deleteRecord(boundaryKey);
    stores.deleteAcquisition(boundaryKey);

    if (dispose !== null) {
        await dispose(record.ownerHandle, {
            dependencies: record.dependencyContext,
            signal
        });
    }
}

function freshDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

async function disposeCompletedBoundary(
    stores: ManagedLifecycleStores,
    boundary: string
): Promise<void> {
    const remaining = stores.remainingBoundaryUses(boundary);

    if (remaining <= 0) {
        await disposeBoundary(stores, boundary, freshDisposalSignal());
    }
}

async function disposeCompletedBoundaries(stores: ManagedLifecycleStores, testCase: TestPlanCase): Promise<void> {
    for (const boundary of caseResourceBoundaries(testCase)) {
        try {
            await disposeCompletedBoundary(stores, boundary);
        } catch (error: unknown) {
            stores.recordCaseError(testCase, 'Resource disposal failed.', error);
        }
    }
}

async function acquireTopLevelResources(
    acquirer: ManagedResourceAcquirer,
    graph: ResourceGraph,
    testCase: TestPlanCase,
    signal: AbortSignal
): Promise<void> {
    await Promise.all(graph.topLevelEntries.map(async function acquireTopLevel([ , resource ]) {
        await acquirer.acquire(resource, testCase, signal);
    }));
}

async function managedResourceHandles(
    acquirer: ManagedResourceAcquirer,
    graph: ResourceGraph,
    testCase: TestPlanCase,
    signal: AbortSignal
): Promise<ReadonlyMap<AnyResourceDefinition, unknown>> {
    const handles = new Map<AnyResourceDefinition, unknown>();

    for (const node of graph.order) {
        const record = await acquirer.acquire(node.descriptor, testCase, signal);

        handles.set(node.descriptor, record.exposedHandle);
    }

    return handles;
}

async function acquireComposedResourcesWithLifecycle(
    stores: ManagedLifecycleStores,
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal
): Promise<ComposedResourceSession> {
    const directResources = resourceMapFromEntries(directResourceEntries(steps));
    const runtimes = stepRuntimeGraphs(steps);
    const combinedResources = combinedResourceEntries(steps);
    const graph = createResourceGraph(combinedResources);
    const testCase = currentRunningCase();
    const acquirer = createManagedResourceAcquirer(stores);

    assertResourceDependencyScopes(combinedResources);
    await acquireTopLevelResources(acquirer, graph, testCase, signal);
    const handles = await managedResourceHandles(acquirer, graph, testCase, signal);

    return composedResourceSession(directResources, runtimes, managedResourceSession(combinedResources, handles));
}

async function acquireManagedComposedResources(
    stores: ManagedLifecycleStores,
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal,
    messages: LifecycleMessages
): Promise<ComposedResourceSession> {
    try {
        return await acquireComposedResourcesWithLifecycle(stores, steps, signal);
    } catch (error: unknown) {
        throw resourceWrapperErrorFromUnknown(messages.acquisitionFailure, error);
    }
}

function createManagedLifecycle(testCases: readonly TestPlanCase[]): ManagedLifecycleState {
    const stores = createManagedStores(testCases);

    return {
        async acquireComposedResources(steps, signal, messages) {
            return await acquireManagedComposedResources(stores, steps, signal, messages);
        },
        async runCase<Value>(testCase: TestPlanCase, run: () => Promise<Value>): Promise<Value> {
            try {
                return await runWithLifecycleCase(testCase, run);
            } finally {
                await disposeCompletedBoundaries(stores, testCase);
            }
        },
        takeCaseErrors(testCase: TestPlanCase) {
            return stores.takeCaseErrors(testCase);
        },
        takeRunErrors() {
            return stores.takeRunErrors();
        }
    };
}

export function createResourceLifecycleRuntimePolicy(testCases: readonly TestPlanCase[]): TestRuntimePolicy {
    const lifecycle = createManagedLifecycle(testCases);

    return {
        async runCase<Value>(testCase: TestPlanCase, run: () => Promise<Value>): Promise<Value> {
            return await runWithManagedLifecycle(lifecycle, async function runWithResourceLifecycle() {
                return await lifecycle.runCase(testCase, run);
            });
        },
        async runLoad<Value>(run: () => Promise<Value>): Promise<Value> {
            return await run();
        },
        takeCaseErrors(testCase) {
            return lifecycle.takeCaseErrors(testCase);
        },
        takeRunErrors() {
            return lifecycle.takeRunErrors();
        }
    };
}
