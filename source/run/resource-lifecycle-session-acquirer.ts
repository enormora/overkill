import { runWithResourceFailureContext } from '../attachments/resource-failure-context.ts';
import { workIdentityKey, type AttemptId } from '../engine/identity.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceProjectionPayload,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
import {
    acquisitionResourceScenarioBindings,
    exposeResourceHandle,
    sourceResourceDefinition
} from '../resources/resource-scenario-binding.ts';
import {
    caseResourceBoundaryKeys,
    boundaryFor,
    initialBoundaryUseCountsFromRecords,
    type LifecycleBoundary
} from './resource-lifecycle-boundaries.ts';
import { resourceWrapperLifecycleError, resourceWrapperErrorFromUnknown } from './resource-lifecycle-error.ts';
import { acquireResourceWithStartupBudget } from './resource-lifecycle-startup-budget.ts';
import {
    deserializeProjectedHandle,
    projectedHandle,
    serializeProjectedHandle,
    type ResourceProjectionRecords
} from './resource-lifecycle-projection.ts';
import {
    currentLifecycleAttempt,
    currentAttachmentExecution,
    type ManagedLifecycleState,
    type ManagedRunnerError
} from './resource-lifecycle-state.ts';
import type { ResourceLifecycleTiming } from './resource-lifecycle-timing.ts';

type TestPlanCase = Parameters<ManagedLifecycleState['completeCase']>[0];

export type ManagedResourceLifecycleTiming = ResourceLifecycleTiming | null;

export type ManagedResourceRecord = {
    readonly boundary: LifecycleBoundary;
    readonly dependencyContext: ResourceContext<ResourceMap>;
    readonly descriptor: AnyResourceDefinition;
    readonly external: boolean;
    readonly consumerHandle: unknown;
    readonly ownerHandle: unknown;
};

type ManagedResourceAcquisition = Promise<ManagedResourceRecord>;

export type ManagedLifecycleStores = {
    readonly deleteAcquisition: (boundaryKey: string) => void;
    readonly deleteRecord: (boundaryKey: string) => void;
    readonly existingAcquisition: (boundaryKey: string) => Promise<ManagedResourceRecord | null>;
    readonly existingRecord: (boundaryKey: string) => ManagedResourceRecord | undefined;
    readonly recordCaseError: (testCase: TestPlanCase, message: string, cause: unknown) => void;
    readonly remainingBoundaryUses: (boundaryKey: string) => number;
    readonly rememberAcquisition: (boundaryKey: string, acquisition: ManagedResourceAcquisition) => void;
    readonly rememberRecord: (boundaryKey: string, record: ManagedResourceRecord) => void;
    readonly takeAttemptErrors: (testCase: TestPlanCase, attempt: AttemptId) => readonly ManagedRunnerError[];
    readonly takePendingRunErrors: () => readonly ManagedRunnerError[];
    readonly takeRunErrors: () => readonly ManagedRunnerError[];
    readonly records: () => readonly ManagedResourceRecord[];
};

export type ManagedResourceAcquirer = {
    readonly acquire: (
        resource: AnyResourceDefinition,
        testCase: TestPlanCase,
        signal: AbortSignal
    ) => Promise<ManagedResourceRecord>;
};

type ResourceLifecycleStoreOptions = {
    readonly testCases: readonly TestPlanCase[];
    readonly boundaryUseCounts: readonly {
        readonly boundaryKey: string;
        readonly count: number;
    }[];
    readonly projectedResources: ResourceProjectionRecords;
    readonly timing: ManagedResourceLifecycleTiming;
};

function caseKey(testCase: TestPlanCase, attempt: AttemptId): string {
    return `${workIdentityKey(testCase.workId)}:${attempt.index}`;
}

function mutableDependencyContext(): Record<string, unknown> {
    return {};
}

export function createManagedStores(options: ResourceLifecycleStoreOptions): ManagedLifecycleStores {
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
            const attempt = currentLifecycleAttempt() ?? { index: 0 };
            const key = caseKey(testCase, attempt);
            const errors = errorsByCase.get(key) ?? [];

            errors.push({
                ...resourceWrapperErrorFromUnknown(message, cause).runnerError(testCase.id, testCase.workId),
                attributedToAttempt: attempt
            });
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
        takeAttemptErrors(testCase, attempt) {
            const key = caseKey(testCase, attempt);
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

export function resourceProjectionRecordsFromStores(stores: ManagedLifecycleStores): ResourceProjectionRecords {
    return {
        resources: stores.records().flatMap(function toProjectionRecord(record) {
            const payload = serializeProjectedHandle(record.descriptor, record.ownerHandle, record.dependencyContext);

            return payload === null
                ? []
                : [ { boundaryKey: record.boundary.key, payload } ];
        })
    };
}

export function managedResourceHandle(record: ManagedResourceRecord, resource: AnyResourceDefinition): unknown {
    return exposeResourceHandle(resource, record.consumerHandle);
}

function assertCompatibleResource(
    stores: ManagedLifecycleStores,
    boundary: LifecycleBoundary,
    resource: AnyResourceDefinition
): void {
    const record = stores.existingRecord(boundary.key);

    if (
        record !== undefined &&
        sourceResourceDefinition(record.descriptor) !== sourceResourceDefinition(resource)
    ) {
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

export function createManagedResourceAcquirer(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleStoreOptions
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
            Object.entries(resource.dependencies).map(async function acquireDependency([ key, dependency ]) {
                const record = await acquireResource(dependency, testCase, signal);

                context[key] = managedResourceHandle(record, dependency);
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
        if (resource.scope !== 'per-case') {
            const consumers = options
                .testCases
                .filter(function consumesBoundary(candidate) {
                    return caseResourceBoundaryKeys(candidate, new Set([ resource.scope ])).includes(boundary.key);
                })
                .map(function consumerWork(candidate) {
                    return candidate.workId;
                });
            await currentAttachmentExecution()?.registerResourceConsumers(boundary.key, consumers);
        }
        const acquireHandle = async function acquireResourceHandle(): Promise<unknown> {
            const condition = resource.scope === 'per-case'
                ? {
                    kind: 'attempt' as const,
                    work: testCase.workId,
                    attempt: currentLifecycleAttempt() ?? { index: 0 }
                }
                : { kind: 'resource' as const, resource: resource.name, boundary: boundary.key };
            return await runWithResourceFailureContext(
                { name: resource.name, condition },
                async function acquireWithFailureCapture(attachments) {
                    return await acquireResourceWithStartupBudget(resource, {
                        attachments,
                        dependencies: dependencyContext,
                        scenarios: acquisitionResourceScenarioBindings(resource),
                        signal
                    });
                }
            );
        };
        const ownerHandle = options.timing === null
            ? await acquireHandle()
            : await options.timing.measure({
                phase: 'acquire',
                resource: { name: resource.name, scope: resource.scope },
                signal
            }, acquireHandle);
        const record = {
            boundary,
            dependencyContext,
            descriptor: resource,
            external: false,
            consumerHandle: projectedHandle(resource, ownerHandle, dependencyContext),
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
            consumerHandle: deserializeProjectedHandle(resource, payload, dependencyContext),
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
            await currentAttachmentExecution()?.markResourceFailure(boundary.key);
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

        const externalRecord = boundary.scope === 'per-run'
            ? await startExternalResource(resource, boundary, testCase, signal)
            : null;

        if (externalRecord !== null) {
            return externalRecord;
        }

        const existingAcquisition = await stores.existingAcquisition(boundary.key);

        return existingAcquisition ?? await acquireNewResource(resource, boundary, testCase, signal);
    }

    acquireResource = acquire;

    return { acquire };
}
