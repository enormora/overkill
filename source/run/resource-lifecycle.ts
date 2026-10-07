import type {
    AnyResourceDefinition,
    ResourceProjectionPayload,
    ResourceScope
} from '../resources/resources.ts';
import {
    assertResourceDependencyScopes,
    createResourceGraph,
    type ResourceGraph
} from '../resources/resource-graph.ts';
import {
    prepareManagedResources,
    closeManagedFailureStreams,
    disposeAllManagedResources,
    completeManagedBoundaries,
    disposeBoundary,
    disposeCompletedBoundaries,
    freshDisposalSignal
} from './resource-lifecycle-disposal.ts';
import type { TestRuntimePolicy, TestPlanCase } from './run-engine-primitives.ts';
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
    prepareOwnedAttempt,
    currentAttachmentExecution,
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
    boundaryFor,
    caseResourceBoundaryKeys,
    resourceLifecycleBoundaryUseCounts,
    resourceScopes,
    type ResourceBoundaryUseCount
} from './resource-lifecycle-boundaries.ts';
import {
    createManagedResourceAcquirer,
    createManagedStores,
    resourceProjectionRecordsFromStores,
    managedResourceHandle,
    type ManagedLifecycleStores,
    type ManagedResourceAcquirer,
    type ManagedResourceLifecycleTiming as SessionResourceLifecycleTiming
} from './resource-lifecycle-session-acquirer.ts';

type WorkId = TestPlanCase['workId'];
type AttemptId = Parameters<TestRuntimePolicy['prepareAttempt']>[1];

export type ManagedResourceLifecycleTiming = SessionResourceLifecycleTiming;

export type ResourceLifecycleSession = {
    readonly prepareAttempt: (work: WorkId, attempt: AttemptId) => Promise<readonly ManagedRunnerError[]>;
    readonly completeBoundaries: (boundaryKeys: readonly string[]) => Promise<readonly ManagedRunnerError[]>;
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
    readonly testCases: readonly TestPlanCase[];
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
    readonly boundaryKeys: ReadonlySet<string>;
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
    readonly boundaryKeys: ReadonlySet<string>;
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
        testCases,
        boundaryUseCounts: resourceLifecycleBoundaryUseCounts(testCases),
        caseDisposalScopes: new Set(resourceScopes),
        projectedResources: { resources: [] },
        timing
    };
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

        handles.set(node.descriptor, managedResourceHandle(record, node.descriptor));
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
        if (
            request.scopes.has(node.descriptor.scope) &&
            request.boundaryKeys.has(boundaryFor(node.descriptor, request.testCase).key)
        ) {
            await acquirer.acquire(node.descriptor, request.testCase, request.signal);
        }
    }
}

async function disposeCaseResources(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleOptions,
    testCase: TestPlanCase
): Promise<void> {
    const boundaries = caseResourceBoundaryKeys(testCase, new Set<ResourceScope>([ 'per-case' ])).toReversed();
    for (const boundary of boundaries) {
        try {
            await disposeBoundary(stores, boundary, {
                signal: freshDisposalSignal(),
                timing: options.timing,
                testCases: options.testCases
            });
        } catch (error: unknown) {
            stores.recordCaseError(testCase, 'Resource disposal failed.', error);
        }
    }
}

function createManagedLifecycleState(options: ResourceLifecycleOptions): ManagedLifecycleStateCreation {
    const stores = createManagedStores(options);
    const context = { options, stores };

    return {
        stores,
        lifecycle: {
            async prepareAttempt(testCase, attempt) {
                await prepareManagedResources(stores, testCase, attempt);
            },
            async acquireComposedResources(steps, signal, messages) {
                return await acquireManagedComposedResources({ ...context, messages, signal, steps });
            },
            async acquireResourceScopes(request) {
                await acquireManagedResourceScopes({ ...context, ...request });
            },
            async disposeAll(signal) {
                return await disposeAllManagedResources(stores, signal, options.timing, options.testCases);
            },
            async completeCase(testCase, attempt) {
                await runWithLifecycleCase(testCase, attempt, async function completeLogicalCase() {
                    await disposeCompletedBoundaries(stores, options, testCase);
                });
            },
            async runAttempt(testCase, attempt, run) {
                try {
                    return await runWithLifecycleCase(testCase, attempt, run);
                } finally {
                    await runWithLifecycleCase(testCase, attempt, async function disposeAttemptResources() {
                        await disposeCaseResources(stores, options, testCase);
                        await closeManagedFailureStreams(stores, testCase, attempt);
                    });
                }
            },
            takeAttemptErrors(testCase, attempt) {
                return stores.takeAttemptErrors(testCase, attempt);
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
        async prepareAttempt(testCase, attempt) {
            await lifecycle.prepareAttempt(testCase, attempt);
        },
        async completeCase(testCase, attempt) {
            const attachments = currentAttachmentExecution();
            const complete = async function completeOwnedCase(): Promise<void> {
                await lifecycle.completeCase(testCase, attempt);
            };
            await (attachments === null ? complete() : attachments.runAttempt(testCase.workId, attempt, complete));
        },
        async runAttempt<Value>(
            testCase: TestPlanCase,
            attempt: Parameters<ManagedLifecycleState['completeCase']>[1],
            run: () => Promise<Value>
        ): Promise<Value> {
            return await runWithManagedLifecycle(lifecycle, async function runWithResourceLifecycle() {
                const attachments = currentAttachmentExecution();
                const execute = async function executeOwnedAttempt(): Promise<Value> {
                    return await lifecycle.runAttempt(testCase, attempt, run);
                };
                return await (attachments === null
                    ? execute()
                    : attachments.runAttempt(testCase.workId, attempt, execute));
            });
        },
        async runLoad<Value>(run: () => Promise<Value>): Promise<Value> {
            return await run();
        },
        takeAttemptErrors(testCase, attempt) {
            return [
                ...lifecycle.takeAttemptErrors(testCase, attempt),
                ...currentAttachmentExecution()?.takeErrors({ kind: 'case', work: testCase.workId, attempt }) ?? []
            ];
        },
        takePendingRunErrors() {
            return [
                ...lifecycle.takePendingRunErrors(),
                ...currentAttachmentExecution()?.takeErrors({ kind: 'run' }) ?? []
            ];
        },
        takeRunErrors() {
            return [ ...lifecycle.takeRunErrors(), ...currentAttachmentExecution()?.takeErrors({ kind: 'run' }) ?? [] ];
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
        async prepareAttempt(work, attempt) {
            return await prepareOwnedAttempt(lifecycle, options.testCases, work, attempt);
        },
        async completeBoundaries(boundaryKeys) {
            return await completeManagedBoundaries(stores, boundaryKeys, options.timing, options.testCases);
        },
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
            await lifecycle.acquireResourceScopes({
                boundaryKeys: request.boundaryKeys,
                scopes: request.scopes,
                signal: request.signal,
                steps: request.stepsForCase(testCase),
                testCase
            });
        }
    });

    return {
        async prepareAttempt(work, attempt) {
            return await prepareOwnedAttempt(lifecycle, request.testCases, work, attempt);
        },
        async completeBoundaries(boundaryKeys) {
            return await completeManagedBoundaries(stores, boundaryKeys, request.options.timing, request.testCases);
        },
        async disposeAll(disposalSignal) {
            return await lifecycle.disposeAll(disposalSignal);
        },
        projectionRecords() {
            return resourceProjectionRecordsFromStores(stores);
        },
        runtimePolicy: createRuntimePolicyFromLifecycle(lifecycle)
    };
}
