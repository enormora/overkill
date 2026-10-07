import type { AnyResourceDefinition } from '../resources/resource-definition-shape.ts';
import { preparedResourceAttachments } from '../packages/resources/attachment-context.entry-point.ts';
import { runWithTranscriptScope } from '../transcript/transcript-store.ts';
import { prepareResourceFailureArtifacts, type ResourceFailureCapture } from '../resources/failure-artifacts.ts';
import { resolvedResourceScenarioBindings } from '../resources/resource-scenario-binding.ts';
import type { AttemptId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { AttachmentOperationError } from './attachment-failure.ts';
import type { ManagedResourceRecord } from './resource-lifecycle-session-acquirer.ts';
import { simulationWitnessAttachments } from './simulation-witness.ts';

function attemptScenarioBindings(
    record: ManagedResourceRecord,
    testCase: TestPlanCase
): Readonly<Record<string, string>> {
    const selected: Readonly<Record<string, string>> = Object.fromEntries(
        testCase.workId.runtimes.flatMap(function runtimeScenarios(runtime) {
            return Object.entries(runtime.scenarios);
        })
    );
    return Object.fromEntries(
        Object.entries(resolvedResourceScenarioBindings(record.descriptor)).map(function resolvedSlot([ name, value ]) {
            return [ name, selected[name] ?? value ];
        })
    );
}
export async function prepareAttemptResource(
    record: ManagedResourceRecord,
    testCase: TestPlanCase,
    attempt: AttemptId
): Promise<void> {
    if (record.external) {
        return;
    }
    const attachments = preparedResourceAttachments(
        record.descriptor.name,
        {
            kind: 'attempt',
            work: testCase.workId,
            attempt
        },
        'instrumented',
        'attachment'
    );
    if (attachments === null) {
        return;
    }
    const controller = new AbortController();
    await prepareResourceFailureArtifacts(record.descriptor, {
        kind: 'attempt',
        handle: record.ownerHandle,
        resource: record.descriptor.name,
        scenarios: attemptScenarioBindings(record, testCase),
        signal: controller.signal,
        work: testCase.workId,
        attempt,
        attachments: simulationWitnessAttachments(attachments, record.descriptor.name, testCase.workId, attempt)
    });
}

async function prepareLifetimeCapture(
    record: ManagedResourceRecord,
    capture: ResourceFailureCapture<AnyResourceDefinition>
): Promise<void> {
    try {
        await runWithTranscriptScope(null, async function prepareLifetimeEvidence() {
            await prepareResourceFailureArtifacts(record.descriptor, capture);
        });
    } catch (error: unknown) {
        throw new AttachmentOperationError('Failure artifact preparation failed.', {
            cause: { resource: record.descriptor.name, cause: error },
            drift: false,
            subtype: 'artifact',
            owner: { kind: 'run' }
        });
    }
}

export async function prepareLifetimeResource(
    record: ManagedResourceRecord
): Promise<void> {
    if (record.external || record.descriptor.scope === 'per-case') {
        return;
    }
    const attachments = preparedResourceAttachments(
        record.descriptor.name,
        {
            kind: 'resource',
            resource: record.descriptor.name,
            boundary: record.boundary.key
        },
        'instrumented',
        'attachment'
    );
    if (attachments !== null) {
        const controller = new AbortController();
        await prepareLifetimeCapture(record, {
            kind: 'lifetime',
            handle: record.ownerHandle,
            resource: record.descriptor.name,
            scenarios: resolvedResourceScenarioBindings(record.descriptor),
            signal: controller.signal,
            attachments
        });
    }
}

export function resourcePreparationError(
    resource: string,
    testCase: TestPlanCase,
    attempt: AttemptId,
    cause: unknown
): AttachmentOperationError {
    if (cause instanceof AttachmentOperationError) {
        return cause;
    }
    return new AttachmentOperationError('Failure artifact preparation failed.', {
        cause: { resource, cause },
        drift: false,
        subtype: 'artifact',
        owner: { kind: 'case', work: testCase.workId, attempt }
    });
}
