import {
    resourceCheckInstallers,
    createResourceCheckSession,
    type ResourceCheckSession
} from '../resources/resource-checks.ts';
import { workIdentityKey, type AttemptId } from '../engine/identity.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceSessionContract,
    ResourceProjectionPayload,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
import {
    exposeResourceHandle,
    sourceResourceDefinition
} from '../resources/resource-scenario-binding.ts';
import { acquireManagedResourceHandle, type ResourceHandleRequest } from './resource-handle-acquisition.ts';
import { replayAcquiredResource, replayResourceDefinition } from './replay-resource.ts';
import {
    caseResourceBoundaryKeys,
    boundaryFor,
    initialBoundaryUseCountsFromRecords,
    type LifecycleBoundary
} from './resource-lifecycle-boundaries.ts';
import { resourceWrapperLifecycleError, resourceWrapperErrorFromUnknown } from './resource-lifecycle-error.ts';
import {
    deserializeProjectedHandle,
    projectedHandle,
    serializeProjectedHandle,
    type ResourceProjectionRecords
} from './resource-lifecycle-projection.ts';
import {
    acquireOwnedResource,
    currentLifecycleAttempt,
    currentAttachmentExecution,
    type ManagedLifecycleState,
    type ManagedRunnerError
} from './resource-lifecycle-state.ts';

type TestPlanCase = Parameters<ManagedLifecycleState['completeCase']>[0];

export type ManagedResourceLifecycleTiming = ResourceHandleRequest['timing'];

export type ManagedResourceRecord = {
    readonly releaseOwner: () => void;
    readonly checks: ResourceCheckSession | null;
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
    readonly existingAcquisition: (boundaryKey: string) => Promise<ManagedResourceRecord> | null;
    readonly existingRecord: (boundaryKey: string) => ManagedResourceRecord | undefined;
    readonly recordCaseError: (testCase: TestPlanCase, message: string, cause: unknown) => void;
    readonly remainingBoundaryUses: (boundaryKey: string) => number;
    readonly rememberAcquisition: (boundaryKey: string, acquisition: ManagedResourceAcquisition) => void;
    readonly rememberRecord: (boundaryKey: string, record: ManagedResourceRecord) => void;
    readonly takeAttemptErrors: (testCase: TestPlanCase, attempt: AttemptId) => readonly ManagedRunnerError[];
    readonly takePendingRunErrors: () => readonly ManagedRunnerError[];
    readonly takeRunErrors: () => readonly ManagedRunnerError[];
    readonly checks: ResourceSessionContract<ResourceContext<ResourceMap>>['resourceChecks'];
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
    const observations = new Set<ResourceCheckSession>();
    const records = new Map<string, ManagedResourceRecord>();
    const runErrors: ManagedRunnerError[] = [];

    return {
        deleteAcquisition(boundaryKey) {
            acquisitions.delete(boundaryKey);
        },
        deleteRecord(boundaryKey) {
            records.delete(boundaryKey);
        },
        existingAcquisition(boundaryKey): Promise<ManagedResourceRecord> | null {
            return acquisitions.get(boundaryKey) ?? null;
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
        checks() {
            return Array.from(observations).flatMap(function (observation) {
                return observation.snapshots();
            });
        },
        rememberRecord(boundaryKey, record) {
            if (record.checks !== null) {
                observations.add(record.checks);
            }
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
            record.checks?.assertAdmitted();
            const payload = serializeProjectedHandle(record.descriptor, record.ownerHandle, record.dependencyContext);

            return payload === null
                ? []
                : [ { boundaryKey: record.boundary.key, payload: payload.payload } ];
        })
    };
}

export function managedResourceHandle(record: ManagedResourceRecord, resource: AnyResourceDefinition): unknown {
    record.checks?.assertAdmitted();
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

async function installManagedObservation(
    record: ManagedResourceRecord,
    signal: AbortSignal
): Promise<ManagedResourceRecord> {
    const { checks } = record;
    if (checks === null) {
        return record;
    }
    const observation = await acquireOwnedResource(async function installOwnerObservation() {
        await checks.install(signal);
    });
    return {
        ...record,
        releaseOwner() {
            try {
                record.releaseOwner();
            } finally {
                observation.releaseOwner();
            }
        }
    };
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

    async function restoreAcquiredResource(
        record: ManagedResourceRecord,
        signal: AbortSignal
    ): Promise<ManagedResourceRecord> {
        stores.rememberRecord(record.boundary.key, record);
        await replayAcquiredResource(record.descriptor, record.ownerHandle, signal);
        const exposed = {
            ...record,
            consumerHandle: projectedHandle(record.descriptor, record.ownerHandle, record.dependencyContext)
        };
        stores.rememberRecord(record.boundary.key, exposed);
        return exposed;
    }

    async function startResource(
        resource: AnyResourceDefinition,
        boundary: LifecycleBoundary,
        testCase: TestPlanCase,
        signal: AbortSignal
    ): Promise<ManagedResourceRecord> {
        const dependencyContext = await acquireDependencyContext(resource, testCase, signal);
        const consumers = options
            .testCases
            .filter(function consumesBoundary(candidate) {
                return caseResourceBoundaryKeys(candidate, new Set([ resource.scope ])).includes(boundary.key);
            })
            .map(function consumerWork(candidate) {
                return candidate.workId;
            });
        if (resource.scope !== 'per-case') {
            await currentAttachmentExecution()?.registerResourceConsumers(boundary.key, consumers);
        }
        const acquisition = await acquireManagedResourceHandle({
            resource,
            boundary,
            testCase,
            signal,
            dependencies: dependencyContext,
            timing: options.timing
        });
        const record = {
            checks: resourceCheckInstallers(resource).length === 0
                ? null
                : createResourceCheckSession(resource, acquisition.value, { kind: 'managed', consumers }),
            releaseOwner: acquisition.releaseOwner,
            boundary,
            dependencyContext,
            descriptor: resource,
            external: false,
            consumerHandle: acquisition.value,
            ownerHandle: acquisition.value
        };

        stores.rememberRecord(record.boundary.key, record);
        const observed = await installManagedObservation(record, signal);
        return await restoreAcquiredResource(observed, signal);
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
            releaseOwner() {
                return undefined;
            },
            external: true,
            consumerHandle: deserializeProjectedHandle(resource, payload, dependencyContext),
            checks: null,
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
        requestedResource: AnyResourceDefinition,
        testCase: TestPlanCase,
        signal: AbortSignal
    ): Promise<ManagedResourceRecord> {
        const resource = replayResourceDefinition(requestedResource);
        const boundary = boundaryFor(resource, testCase);
        const existingRecord = stores.existingRecord(boundary.key);

        assertCompatibleResource(stores, boundary, resource);

        if (existingRecord !== undefined) {
            return await (stores.existingAcquisition(boundary.key) ?? existingRecord);
        }

        const externalRecord = externalProjections.has(boundary.key)
            ? await startExternalResource(resource, boundary, testCase, signal)
            : null;

        if (externalRecord !== null) {
            return externalRecord;
        }

        return await (stores.existingAcquisition(boundary.key) ??
            acquireNewResource(resource, boundary, testCase, signal));
    }

    acquireResource = acquire;

    return { acquire };
}
