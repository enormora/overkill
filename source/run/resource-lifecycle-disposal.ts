import { resourceAttachments } from '../packages/resources/attachment-context.entry-point.ts';
import { closeAttemptFailureStreams } from '../attachments/failure-artifact-stream.ts';
import { callableResourceDefinition } from '../resources/resource-graph.ts';
import { resourceDisposalErrors, resourceDisposalCauses } from './resource-disposal-error.ts';
import {
    prepareLifetimeResource,
    prepareAttemptResource,
    resourcePreparationError
} from './resource-failure-preparation.ts';
import { lifecycleScenarioBindings } from './resource-lifecycle-composition.ts';
import {
    currentAttachmentExecution,
    type ManagedRunnerError,
    type ManagedLifecycleState
} from './resource-lifecycle-state.ts';
import { caseResourceBoundaryKeys, resourceScopes } from './resource-lifecycle-boundaries.ts';
import type { TestPlanCase } from './run-engine-primitives.ts';
import type {
    ManagedResourceLifecycleTiming,
    ManagedLifecycleStores,
    ManagedResourceRecord
} from './resource-lifecycle-session-acquirer.ts';

type AttemptId = Parameters<ManagedLifecycleState['prepareAttempt']>[1];
type ResourceLifecycleDisposalPolicy = {
    readonly caseDisposalScopes: ReadonlySet<ManagedResourceRecord['descriptor']['scope']>;
    readonly timing: ManagedResourceLifecycleTiming;
    readonly testCases: readonly TestPlanCase[];
};
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
            attachments: resourceAttachments(record.descriptor.name),
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

type ResourceDisposalRequest = {
    readonly signal: AbortSignal;
    readonly timing: ManagedResourceLifecycleTiming;
    readonly testCases: readonly TestPlanCase[];
};
async function disposePreparedResource(record: ManagedResourceRecord, request: ResourceDisposalRequest): Promise<void> {
    const [ preparation ] = await Promise.allSettled([ prepareLifetimeResource(record) ]);
    const [ disposal ] = await Promise.allSettled([ disposeResourceRecord(record, request.signal, request.timing) ]);
    const failures = [ preparation, disposal ].flatMap(function failure(result) {
        return result.status === 'rejected'
            ? [
                result.reason instanceof Error
                    ? result.reason
                    : new Error('Resource cleanup failed.', { cause: result.reason })
            ]
            : [];
    });
    if (failures.length > 0) {
        await currentAttachmentExecution()?.markResourceFailure(record.boundary.key);
        if (failures.length === 1 && failures[0] !== undefined) {
            throw failures[0];
        }
        throw new AggregateError(failures, 'Resource cleanup failed.');
    }
}
export async function disposeBoundary(
    stores: ManagedLifecycleStores,
    boundaryKey: string,
    request: ResourceDisposalRequest
): Promise<void> {
    const record = stores.existingRecord(boundaryKey);
    if (record === undefined) {
        return;
    }
    stores.deleteRecord(boundaryKey);
    stores.deleteAcquisition(boundaryKey);
    await disposePreparedResource(record, request);
}

export function freshDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

async function disposeCompletedBoundary(
    stores: ManagedLifecycleStores,
    boundary: string,
    timing: ManagedResourceLifecycleTiming,
    testCases: readonly TestPlanCase[]
): Promise<void> {
    const remaining = stores.remainingBoundaryUses(boundary);

    if (remaining <= 0) {
        await disposeBoundary(stores, boundary, { signal: freshDisposalSignal(), timing, testCases });
    }
}

export async function disposeCompletedBoundaries(
    stores: ManagedLifecycleStores,
    options: ResourceLifecycleDisposalPolicy,
    testCase: TestPlanCase
): Promise<void> {
    const sharedScopes = new Set(
        Array.from(options.caseDisposalScopes).filter(function isShared(scope) {
            return scope !== 'per-case';
        })
    );
    for (const boundary of caseResourceBoundaryKeys(testCase, sharedScopes).toReversed()) {
        try {
            await disposeCompletedBoundary(stores, boundary, options.timing, options.testCases);
        } catch (error: unknown) {
            for (const cause of resourceDisposalCauses(error)) {
                stores.recordCaseError(testCase, 'Resource disposal failed.', cause);
            }
        }
    }
}

export async function prepareManagedResources(
    stores: ManagedLifecycleStores,
    testCase: TestPlanCase,
    attempt: AttemptId
): Promise<void> {
    const boundaries = caseResourceBoundaryKeys(testCase, new Set(resourceScopes));
    for (const record of stores.records()) {
        if (boundaries.includes(record.boundary.key)) {
            try {
                await prepareAttemptResource(record, testCase, attempt);
            } catch (error: unknown) {
                stores.recordCaseError(
                    testCase,
                    'Failure artifact preparation failed.',
                    resourcePreparationError(record.descriptor.name, testCase, attempt, error)
                );
            }
        }
    }
}
export async function closeManagedFailureStreams(
    stores: ManagedLifecycleStores,
    testCase: TestPlanCase,
    attempt: AttemptId
): Promise<void> {
    try {
        await closeAttemptFailureStreams(testCase.workId, attempt);
    } catch (error: unknown) {
        stores.recordCaseError(
            testCase,
            'Failure artifact capture failed.',
            resourcePreparationError('integration resources', testCase, attempt, error)
        );
    }
}

export async function disposeAllManagedResources(
    stores: ManagedLifecycleStores,
    signal: AbortSignal,
    timing: ManagedResourceLifecycleTiming,
    testCases: readonly TestPlanCase[]
): Promise<readonly ManagedRunnerError[]> {
    const errors: ManagedRunnerError[] = [];

    for (const record of stores.records().toReversed()) {
        try {
            await disposeBoundary(stores, record.boundary.key, { signal, timing, testCases });
        } catch (error: unknown) {
            errors.push(...resourceDisposalErrors(error));
        }
    }

    return errors;
}

export async function completeManagedBoundaries(
    stores: ManagedLifecycleStores,
    boundaryKeys: readonly string[],
    timing: ManagedResourceLifecycleTiming,
    testCases: readonly TestPlanCase[]
): Promise<readonly ManagedRunnerError[]> {
    const errors: ManagedRunnerError[] = [];

    for (const boundaryKey of boundaryKeys) {
        try {
            await disposeCompletedBoundary(stores, boundaryKey, timing, testCases);
        } catch (error: unknown) {
            errors.push(...resourceDisposalErrors(error));
        }
    }

    return errors;
}
