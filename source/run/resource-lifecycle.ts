import { workIdentityKey } from '../engine/identity.ts';
import type { TestRuntimePolicy } from '../engine/case-execution.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceProjectionContext,
    ResourceCreationContext,
    ResourceProjectionPayload,
    ResourceScope,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
import {
    assertResourceDependencyScopes,
    callableResourceDefinition,
    createResourceGraph,
    resourceEntries,
    type ResourceGraph
} from '../resources/resource-graph.ts';
import {
    combinedResourceEntries,
    composedResourceSession,
    directResourceEntries,
    resourceMapFromEntries,
    stepRuntimeGraphs,
    type ComposedResourceSession,
    type LifecycleMessages,
    type ResourceWrapperStep
} from './resource-lifecycle-composition.ts';
import {
    currentLifecycleCase,
    runWithLifecycleCase,
    runWithManagedLifecycle,
    type ManagedLifecycleState,
    type ManagedRunnerError
} from './resource-lifecycle-state.ts';
import {
    resourceWrapperErrorFromUnknown,
    resourceWrapperLifecycleError
} from './resource-lifecycle-error.ts';
import { managedResourceSession } from './resource-lifecycle-managed-session.ts';

type LifecycleBoundary = {
    readonly key: string;
    readonly scope: ResourceScope;
};

export type ResourceBoundaryUseCount = {
    readonly boundaryKey: string;
    readonly count: number;
};
export type ResourceProjectionRecord = {
    readonly boundaryKey: string;
    readonly payload: ResourceProjectionPayload;
};
export type ResourceProjectionRecords = {
    readonly resources: readonly ResourceProjectionRecord[];
};
export type ResourceLifecycleSession = {
    readonly disposeAll: (signal: AbortSignal) => Promise<readonly ManagedRunnerError[]>;
    readonly projectionRecords: () => ResourceProjectionRecords;
    readonly runtimePolicy: TestRuntimePolicy;
};

type ManagedResourceRecord = {
    readonly boundary: LifecycleBoundary;
    readonly dependencyContext: ResourceContext<ResourceMap>;
    readonly descriptor: AnyResourceDefinition;
    readonly external: boolean;
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
    readonly takePendingRunErrors: () => readonly ManagedRunnerError[];
    readonly takeRunErrors: () => readonly ManagedRunnerError[];
    readonly records: () => readonly ManagedResourceRecord[];
};

export type ResourceLifecycleOptions = {
    readonly boundaryUseCounts: readonly ResourceBoundaryUseCount[];
    readonly caseDisposalScopes: ReadonlySet<ResourceScope>;
    readonly projectedResources: ResourceProjectionRecords;
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

function serializeProjectedHandle(
    resource: AnyResourceDefinition,
    ownerHandle: unknown,
    dependencyContext: ResourceContext<ResourceMap>
): ResourceProjectionPayload | null {
    if (!resourceHasProjection(resource)) {
        return null;
    }

    const context = { dependencies: dependencyContext };
    const payload = resource.serializeHandle(ownerHandle, context);

    if (!isProjectionPayload(payload)) {
        throw resourceWrapperLifecycleError(
            `Resource "${resource.name}" returned a non-JSON projection payload.`,
            payload
        );
    }

    return payload;
}

function projectedHandle(
    resource: AnyResourceDefinition,
    ownerHandle: unknown,
    dependencyContext: ResourceContext<ResourceMap>
): unknown {
    const payload = serializeProjectedHandle(resource, ownerHandle, dependencyContext);

    return payload === null
        ? ownerHandle
        : deserializeProjectedHandle(resource, payload, dependencyContext);
}

function deserializeProjectedHandle(
    resource: AnyResourceDefinition,
    payload: ResourceProjectionPayload,
    dependencyContext: ResourceContext<ResourceMap>
): unknown {
    if (!resourceHasProjection(resource)) {
        throw resourceWrapperLifecycleError(
            `Resource "${resource.name}" requires a projection for worker-pool per-run ownership.`,
            resource
        );
    }

    return resource.deserializeHandle(payload, { dependencies: dependencyContext });
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
        : { key: `case:${workIdentityKey(testCase.workId)}:${resourceName}`, scope };
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

function caseResourceBoundaries(testCase: TestPlanCase): readonly LifecycleBoundary[] {
    return Array.from(
        new Map(testCase.resourceAttachments.resourceGraph.flatMap(function toBoundary(resource) {
            if (!isResourceScope(resource.scope)) {
                return [];
            }

            const boundary = resourceBoundary(resource.name, resource.scope, testCase);

            return [ [ boundary.key, boundary ] ];
        }))
            .values()
    );
}

function initialBoundaryUseCounts(testCases: readonly TestPlanCase[]): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();

    for (const testCase of testCases) {
        for (const boundary of caseResourceBoundaries(testCase)) {
            counts.set(boundary.key, (counts.get(boundary.key) ?? 0) + 1);
        }
    }

    return counts;
}

function initialBoundaryUseCountsFromRecords(
    counts: readonly ResourceBoundaryUseCount[]
): ReadonlyMap<string, number> {
    return new Map(counts.map(function toEntry(count) {
        return [ count.boundaryKey, count.count ];
    }));
}

export function resourceLifecycleBoundaryUseCounts(
    testCases: readonly TestPlanCase[]
): readonly ResourceBoundaryUseCount[] {
    return Array.from(initialBoundaryUseCounts(testCases), function toCount([ boundaryKey, count ]) {
        return { boundaryKey, count };
    });
}

function defaultLifecycleOptions(testCases: readonly TestPlanCase[]): ResourceLifecycleOptions {
    return {
        boundaryUseCounts: resourceLifecycleBoundaryUseCounts(testCases),
        caseDisposalScopes: new Set(resourceScopes) as ReadonlySet<ResourceScope>,
        projectedResources: { resources: [] }
    };
}

function caseResourceBoundaryKeys(testCase: TestPlanCase, scopes: ReadonlySet<ResourceScope>): readonly string[] {
    return caseResourceBoundaries(testCase).flatMap(function toBoundaryKey(boundary) {
        return scopes.has(boundary.scope) ? [ boundary.key ] : [];
    });
}

function caseKey(testCase: TestPlanCase): string {
    return workIdentityKey(testCase.workId);
}

function mutableDependencyContext(): Record<string, unknown> {
    return {};
}

function createManagedStores(options: ResourceLifecycleOptions): ManagedLifecycleStores {
    const acquisitions = new Map<string, ManagedResourceAcquisition>();
    const boundaryUseCounts = new Map(initialBoundaryUseCountsFromRecords(options.boundaryUseCounts));
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

            errors.push(resourceWrapperLifecycleError(message, cause).runnerError(testCase.id, testCase.workId));
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
        records() {
            return Array.from(records.values());
        },
        takeCaseErrors(testCase) {
            const key = caseKey(testCase);
            const errors = errorsByCase.get(key) ?? [];

            errorsByCase.delete(key);

            return errors;
        },
        takePendingRunErrors() {
            const errors = Array.from(runErrors);
            runErrors.length = 0;

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

function projectionRecords(records: ResourceProjectionRecords): ReadonlyMap<string, ResourceProjectionPayload> {
    return new Map(records.resources.map(function toEntry(record) {
        return [ record.boundaryKey, record.payload ];
    }));
}

function startupBudgetMilliseconds(resource: AnyResourceDefinition): number | null {
    const budgets = resource.requirements.flatMap(function toBudget(requirement) {
        const kind = Reflect.get(requirement, 'kind');
        const minimumMilliseconds = Reflect.get(requirement, 'minimumMilliseconds');

        return kind === 'startup-budget-milliseconds' &&
                typeof minimumMilliseconds === 'number' &&
            Number.isFinite(minimumMilliseconds) &&
                minimumMilliseconds >= 0
            ? [ minimumMilliseconds ]
            : [];
    });

    return budgets.length === 0 ? null : Math.max(...budgets);
}

async function acquireResourceWithStartupBudget(
    resource: AnyResourceDefinition,
    context: ResourceCreationContext<ResourceMap>
): Promise<unknown> {
    const budgetMilliseconds = startupBudgetMilliseconds(resource);

    if (budgetMilliseconds === null) {
        return await callableResourceDefinition(resource).acquire(context);
    }

    const controller = new AbortController();
    let rejectTimeout: (error: Error) => void = function rejectBeforeTimeoutReady(error) {
        throw error;
    };
    const timedOut = new Promise<never>(function createStartupTimeout(_resolve, reject) {
        rejectTimeout = reject;
    });
    const abortForParentSignal = function abortForParentSignal(): void {
        controller.abort(context.signal.reason);
    };
    const timeout = setTimeout(function abortForStartupBudget() {
        const error = new Error(`Resource "${resource.name}" exceeded startup budget of ${budgetMilliseconds} ms.`);

        controller.abort(error);
        rejectTimeout(error);
    }, budgetMilliseconds);

    context.signal.addEventListener('abort', abortForParentSignal, { once: true });

    try {
        return await Promise.race([
            callableResourceDefinition(resource).acquire({
                dependencies: context.dependencies,
                signal: controller.signal
            }),
            timedOut
        ]);
    } finally {
        clearTimeout(timeout);
        context.signal.removeEventListener('abort', abortForParentSignal);
    }
}

function createManagedResourceAcquirer(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleOptions
): ManagedResourceAcquirer {
    const externalProjections = projectionRecords(options.projectedResources);
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
        const ownerHandle = await acquireResourceWithStartupBudget(resource, {
            dependencies: dependencyContext,
            signal
        });
        const record = {
            boundary,
            dependencyContext,
            descriptor: resource,
            external: false,
            exposedHandle: projectedHandle(resource, ownerHandle, dependencyContext),
            ownerHandle
        };

        stores.rememberRecord(boundary.key, record);

        return record;
    }

    async function startExternalResource(
        resource: AnyResourceDefinition,
        boundary: LifecycleBoundary,
        testCase: TestPlanCase,
        signal: AbortSignal
    ): Promise<ManagedResourceRecord | null> {
        const payload = externalProjections.get(boundary.key);

        if (payload === undefined) {
            return null;
        }

        const dependencyContext = await acquireDependencyContext(resource, testCase, signal);
        const record = {
            boundary,
            dependencyContext,
            descriptor: resource,
            external: true,
            exposedHandle: deserializeProjectedHandle(resource, payload, dependencyContext),
            ownerHandle: null
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

        if (boundary.scope === 'per-run') {
            const externalRecord = await startExternalResource(resource, boundary, testCase, signal);

            if (externalRecord !== null) {
                return externalRecord;
            }
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

    if (!record.external && dispose !== null) {
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

async function disposeCompletedBoundaries(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleOptions,
    testCase: TestPlanCase
): Promise<void> {
    for (const boundary of caseResourceBoundaryKeys(testCase, options.caseDisposalScopes)) {
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
    options: ResourceLifecycleOptions,
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal
): Promise<ComposedResourceSession> {
    const testCase = currentRunningCase();
    const directResources = resourceMapFromEntries(directResourceEntries(steps));
    const runtimes = stepRuntimeGraphs(steps);
    const combinedResources = combinedResourceEntries(steps, testCase.workId);
    const graph = createResourceGraph(combinedResources);
    const acquirer = createManagedResourceAcquirer(stores, options);

    assertResourceDependencyScopes(combinedResources);
    await acquireTopLevelResources(acquirer, graph, testCase, signal);
    const handles = await managedResourceHandles(acquirer, graph, testCase, signal);

    return composedResourceSession(
        directResources,
        runtimes,
        managedResourceSession(combinedResources, handles),
        testCase.workId
    );
}

async function acquireManagedComposedResources(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleOptions,
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal,
    messages: LifecycleMessages
): Promise<ComposedResourceSession> {
    try {
        return await acquireComposedResourcesWithLifecycle(stores, options, steps, signal);
    } catch (error: unknown) {
        throw resourceWrapperErrorFromUnknown(messages.acquisitionFailure, error);
    }
}

async function acquireManagedResourceScopes(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleOptions,
    steps: readonly ResourceWrapperStep[],
    testCase: TestPlanCase,
    signal: AbortSignal,
    scopes: ReadonlySet<string>
): Promise<void> {
    const combinedResources = combinedResourceEntries(steps, testCase.workId);
    const graph = createResourceGraph(combinedResources);
    const acquirer = createManagedResourceAcquirer(stores, options);

    assertResourceDependencyScopes(combinedResources);

    for (const node of graph.order) {
        if (scopes.has(node.descriptor.scope)) {
            await acquirer.acquire(node.descriptor, testCase, signal);
        }
    }
}

async function disposeAllManagedResources(
    stores: ManagedLifecycleStores,
    signal: AbortSignal
): Promise<readonly ManagedRunnerError[]> {
    const errors: ManagedRunnerError[] = [];

    for (const record of stores.records().toReversed()) {
        try {
            await disposeBoundary(stores, record.boundary.key, signal);
        } catch (error: unknown) {
            errors.push({
                attributedTo: null,
                attributedToWork: null,
                cause: error,
                diagnostics: [],
                message: 'Resource disposal failed.',
                subtype: 'runtime-policy'
            });
        }
    }

    return errors;
}

function projectionRecordsFromStores(stores: ManagedLifecycleStores): ResourceProjectionRecords {
    return {
        resources: stores.records().flatMap(function toProjectionRecord(record) {
            const payload = serializeProjectedHandle(record.descriptor, record.ownerHandle, record.dependencyContext);

            return payload === null
                ? []
                : [ { boundaryKey: record.boundary.key, payload } ];
        })
    };
}

function createManagedLifecycleState(options: ResourceLifecycleOptions): {
    readonly lifecycle: ManagedLifecycleState;
    readonly stores: ManagedLifecycleStores;
} {
    const stores = createManagedStores(options);

    return {
        stores,
        lifecycle: {
            async acquireComposedResources(steps, signal, messages) {
                return await acquireManagedComposedResources(stores, options, steps, signal, messages);
            },
            async acquireResourceScopes(steps, testCase, signal, scopes) {
                await acquireManagedResourceScopes(stores, options, steps, testCase, signal, scopes);
            },
            async disposeAll(signal) {
                return await disposeAllManagedResources(stores, signal);
            },
            async runCase<Value>(testCase: TestPlanCase, run: () => Promise<Value>): Promise<Value> {
                try {
                    return await runWithLifecycleCase(testCase, run);
                } finally {
                    await disposeCompletedBoundaries(stores, options, testCase);
                }
            },
            takeCaseErrors(testCase: TestPlanCase) {
                return stores.takeCaseErrors(testCase);
            },
            takePendingRunErrors() {
                return stores.takePendingRunErrors();
            },
            takeRunErrors() {
                return stores.takeRunErrors();
            }
        }
    };
}

function createRuntimePolicyFromLifecycle(lifecycle: ManagedLifecycleState): TestRuntimePolicy {
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
        takePendingRunErrors() {
            return lifecycle.takePendingRunErrors();
        },
        takeRunErrors() {
            return lifecycle.takeRunErrors();
        }
    };
}

export function createResourceLifecycleRuntimePolicy(testCases: readonly TestPlanCase[]): TestRuntimePolicy {
    const { lifecycle } = createManagedLifecycleState(defaultLifecycleOptions(testCases));

    return createRuntimePolicyFromLifecycle(lifecycle);
}

export function createResourceLifecycleSession(options: ResourceLifecycleOptions): ResourceLifecycleSession {
    const { lifecycle, stores } = createManagedLifecycleState(options);

    return {
        async disposeAll(signal) {
            return await lifecycle.disposeAll(signal);
        },
        projectionRecords() {
            return projectionRecordsFromStores(stores);
        },
        runtimePolicy: createRuntimePolicyFromLifecycle(lifecycle)
    };
}

export async function acquireResourceLifecycleScopes(
    options: ResourceLifecycleOptions,
    testCases: readonly TestPlanCase[],
    stepsForCase: (testCase: TestPlanCase) => readonly ResourceWrapperStep[],
    signal: AbortSignal,
    scopes: ReadonlySet<string>
): Promise<ResourceLifecycleSession> {
    const { lifecycle, stores } = createManagedLifecycleState(options);

    await runWithManagedLifecycle(lifecycle, async function acquireSelectedScopes() {
        for (const testCase of testCases) {
            await lifecycle.acquireResourceScopes(stepsForCase(testCase), testCase, signal, scopes);
        }
    });

    return {
        async disposeAll(disposalSignal) {
            return await lifecycle.disposeAll(disposalSignal);
        },
        projectionRecords() {
            return projectionRecordsFromStores(stores);
        },
        runtimePolicy: createRuntimePolicyFromLifecycle(lifecycle)
    };
}
