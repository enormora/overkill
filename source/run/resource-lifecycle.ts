import type { TestRuntimePolicy } from '../engine/case-execution.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import type {
    AnyResourceDefinition,
    ResourceProjectionPayload,
    ResourceScope
} from '../resources/resources.ts';
import {
    assertResourceDependencyScopes,
    callableResourceDefinition,
    createResourceGraph,
    type ResourceGraph
} from '../resources/resource-graph.ts';
import {
    combinedResourceEntries,
    composedResourceSession,
    directResourceEntries,
    lifecycleScenarioBindings,
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
import {
    caseResourceBoundaryKeys,
    resourceLifecycleBoundaryUseCounts,
    resourceScopes,
    type ResourceBoundaryUseCount
} from './resource-lifecycle-boundaries.ts';
import {
    createManagedResourceAcquirer,
    createManagedStores,
    resourceProjectionRecordsFromStores,
    type ManagedLifecycleStores,
    type ManagedResourceAcquirer,
    type ManagedResourceLifecycleTiming as SessionResourceLifecycleTiming,
    type ManagedResourceRecord
} from './resource-lifecycle-session-acquirer.ts';

export type ManagedResourceLifecycleTiming = SessionResourceLifecycleTiming;

export type ResourceLifecycleSession = {
    readonly disposeAll: (signal: AbortSignal) => Promise<readonly ManagedRunnerError[]>;
    readonly projectionRecords: () => ResourceProjectionRecords;
    readonly runtimePolicy: TestRuntimePolicy;
};

type ResourceProjectionRecord = {
    readonly boundaryKey: string;
    readonly payload: ResourceProjectionPayload;
};

type ResourceProjectionRecords = {
    readonly resources: readonly ResourceProjectionRecord[];
};

export type ResourceLifecycleOptions = {
    readonly boundaryUseCounts: readonly ResourceBoundaryUseCount[];
    readonly caseDisposalScopes: ReadonlySet<ResourceScope>;
    readonly projectedResources: ResourceProjectionRecords;
    readonly timing: ManagedResourceLifecycleTiming;
};

type ManagedLifecycleContext = {
    readonly options: ResourceLifecycleOptions;
    readonly stores: ManagedLifecycleStores;
};

type ManagedComposedResourcesRequest = ManagedLifecycleContext & {
    readonly messages: LifecycleMessages;
    readonly signal: AbortSignal;
    readonly steps: readonly ResourceWrapperStep[];
};

type ManagedResourceScopesRequest = ManagedLifecycleContext & {
    readonly scopes: ReadonlySet<string>;
    readonly signal: AbortSignal;
    readonly steps: readonly ResourceWrapperStep[];
    readonly testCase: TestPlanCase;
};

type ManagedLifecycleStateCreation = {
    readonly lifecycle: ManagedLifecycleState;
    readonly stores: ManagedLifecycleStores;
};

export type ResourceLifecycleScopesRequest = {
    readonly options: ResourceLifecycleOptions;
    readonly scopes: ReadonlySet<string>;
    readonly signal: AbortSignal;
    readonly stepsForCase: (testCase: TestPlanCase) => readonly ResourceWrapperStep[];
    readonly testCases: readonly TestPlanCase[];
};

function currentRunningCase(): TestPlanCase {
    const testCase = currentLifecycleCase();

    if (testCase === null) {
        throw resourceWrapperLifecycleError('Resource lifecycle is not attached to a running test case.', null);
    }

    return testCase;
}

function defaultLifecycleOptions(
    testCases: readonly TestPlanCase[],
    timing: ManagedResourceLifecycleTiming
): ResourceLifecycleOptions {
    return {
        boundaryUseCounts: resourceLifecycleBoundaryUseCounts(testCases),
        caseDisposalScopes: new Set(resourceScopes),
        projectedResources: { resources: [] },
        timing
    };
}

async function disposeResourceRecord(
    record: ManagedResourceRecord,
    signal: AbortSignal,
    timing: ManagedResourceLifecycleTiming
): Promise<void> {
    const { dispose } = callableResourceDefinition(record.descriptor);

    if (record.external || dispose === null) {
        return;
    }

    const disposeHandle = async function disposeResourceHandle(): Promise<void> {
        await dispose(record.ownerHandle, {
            dependencies: record.dependencyContext,
            scenarios: lifecycleScenarioBindings(record.descriptor),
            signal
        });
    };

    if (timing === null) {
        await disposeHandle();
    } else {
        await timing.measure({
            phase: 'dispose',
            resource: { name: record.descriptor.name, scope: record.descriptor.scope },
            signal
        }, disposeHandle);
    }
}

async function disposeBoundary(
    stores: ManagedLifecycleStores,
    boundaryKey: string,
    signal: AbortSignal,
    timing: ManagedResourceLifecycleTiming
): Promise<void> {
    const record = stores.existingRecord(boundaryKey);

    if (record === undefined) {
        return;
    }

    stores.deleteRecord(boundaryKey);
    stores.deleteAcquisition(boundaryKey);

    await disposeResourceRecord(record, signal, timing);
}

function freshDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

async function disposeCompletedBoundary(
    stores: ManagedLifecycleStores,
    boundary: string,
    timing: ManagedResourceLifecycleTiming
): Promise<void> {
    const remaining = stores.remainingBoundaryUses(boundary);

    if (remaining <= 0) {
        await disposeBoundary(stores, boundary, freshDisposalSignal(), timing);
    }
}

async function disposeCompletedBoundaries(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleOptions,
    testCase: TestPlanCase
): Promise<void> {
    for (const boundary of caseResourceBoundaryKeys(testCase, options.caseDisposalScopes)) {
        try {
            await disposeCompletedBoundary(stores, boundary, options.timing);
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
    request: ManagedComposedResourcesRequest
): Promise<ComposedResourceSession> {
    try {
        return await acquireComposedResourcesWithLifecycle(
            request.stores,
            request.options,
            request.steps,
            request.signal
        );
    } catch (error: unknown) {
        throw resourceWrapperErrorFromUnknown(request.messages.acquisitionFailure, error);
    }
}

async function acquireManagedResourceScopes(
    request: ManagedResourceScopesRequest
): Promise<void> {
    const combinedResources = combinedResourceEntries(request.steps, request.testCase.workId);
    const graph = createResourceGraph(combinedResources);
    const acquirer = createManagedResourceAcquirer(request.stores, request.options);

    assertResourceDependencyScopes(combinedResources);

    for (const node of graph.order) {
        if (request.scopes.has(node.descriptor.scope)) {
            await acquirer.acquire(node.descriptor, request.testCase, request.signal);
        }
    }
}

async function disposeAllManagedResources(
    stores: ManagedLifecycleStores,
    signal: AbortSignal,
    timing: ManagedResourceLifecycleTiming
): Promise<readonly ManagedRunnerError[]> {
    const errors: ManagedRunnerError[] = [];

    for (const record of stores.records().toReversed()) {
        try {
            await disposeBoundary(stores, record.boundary.key, signal, timing);
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

function createManagedLifecycleState(options: ResourceLifecycleOptions): ManagedLifecycleStateCreation {
    const stores = createManagedStores(options);
    const context = { options, stores };

    return {
        stores,
        lifecycle: {
            async acquireComposedResources(steps, signal, messages) {
                return await acquireManagedComposedResources({ ...context, messages, signal, steps });
            },
            async acquireResourceScopes(steps, testCase, signal, scopes) {
                await acquireManagedResourceScopes({ ...context, scopes, signal, steps, testCase });
            },
            async disposeAll(signal) {
                return await disposeAllManagedResources(stores, signal, options.timing);
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

export function createResourceLifecycleRuntimePolicy(
    testCases: readonly TestPlanCase[],
    timing: ManagedResourceLifecycleTiming
): TestRuntimePolicy {
    const { lifecycle } = createManagedLifecycleState(defaultLifecycleOptions(testCases, timing));

    return createRuntimePolicyFromLifecycle(lifecycle);
}

export function createResourceLifecycleSession(options: ResourceLifecycleOptions): ResourceLifecycleSession {
    const { lifecycle, stores } = createManagedLifecycleState(options);

    return {
        async disposeAll(signal) {
            return await lifecycle.disposeAll(signal);
        },
        projectionRecords() {
            return resourceProjectionRecordsFromStores(stores);
        },
        runtimePolicy: createRuntimePolicyFromLifecycle(lifecycle)
    };
}

export async function acquireResourceLifecycleScopes(
    request: ResourceLifecycleScopesRequest
): Promise<ResourceLifecycleSession> {
    const { lifecycle, stores } = createManagedLifecycleState(request.options);

    await runWithManagedLifecycle(lifecycle, async function acquireSelectedScopes() {
        for (const testCase of request.testCases) {
            await lifecycle.acquireResourceScopes(
                request.stepsForCase(testCase),
                testCase,
                request.signal,
                request.scopes
            );
        }
    });

    return {
        async disposeAll(disposalSignal) {
            return await lifecycle.disposeAll(disposalSignal);
        },
        projectionRecords() {
            return resourceProjectionRecordsFromStores(stores);
        },
        runtimePolicy: createRuntimePolicyFromLifecycle(lifecycle)
    };
}
