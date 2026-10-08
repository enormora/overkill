import { randomUUID } from 'node:crypto';
import type { AttemptId, WorkId } from '../engine/identity.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { createStoredRunValue, type StoredRunValue } from './supervised-run-state.ts';
import { attachmentArtifacts, attachmentMatchesAttempt, resultWithRuntimeAttachments } from './attachment-results.ts';
import type { AttachmentStorageSession } from './attachment-storage-session.ts';
import { createAttachmentExecution, type AttachmentExecution } from './attachment-execution.ts';
import type { AttachmentCoordinator } from './attachment-coordinator-context.ts';
import type { AttachmentEndpoint } from './attachment-protocol.ts';

export type AttachmentRunCoordinator = AttachmentCoordinator & {
    readonly artifacts: () => readonly RuntimeAttachmentArtifact[];
    readonly execution: AttachmentExecution;
    readonly close: () => Promise<void>;
};
type AttachmentRunCoordinatorState = {
    readonly storage: AttachmentStorageSession;
    readonly store: AttachmentStorageSession['store'];
    readonly server: AttachmentStorageSession['server'];
    readonly resolved: AttachmentStorageSession['resolved'];
    readonly branches: WeakMap<Readonly<Record<string, unknown>>, string>;
    readonly execution: AttachmentExecution;
    readonly endpoint: AttachmentEndpoint;
    readonly finalized: StoredRunValue<RunResult | null>;
};
function attachmentRunCoordinatorBranchEndpoint(
    state: AttachmentRunCoordinatorState,
    branch: Readonly<Record<string, unknown>>,
    retain: () => boolean
): AttachmentEndpoint {
    const { branches, store } = state;

    const id = branches.get(branch) ?? randomUUID();
    branches.set(branch, id);
    store.registerBranch(id, retain);
    return { ...state.endpoint, branch: id };
}
function attachmentRunCoordinatorBranchArtifacts(
    state: AttachmentRunCoordinatorState,
    branch: Readonly<Record<string, unknown>>
): readonly RuntimeAttachmentArtifact[] {
    const { branches, store } = state;

    const id = branches.get(branch);
    return id === undefined ? [] : store.conflictArtifacts(id);
}
function attachmentRunCoordinatorCaseArtifacts(
    state: AttachmentRunCoordinatorState,
    work: WorkId,
    attempt: AttemptId,
    branch: Readonly<Record<string, unknown>> | null
): readonly RuntimeAttachmentArtifact[] {
    const { store } = state;

    const artifacts = branch === null
        ? store.branchArtifacts(null)
        : store.branchArtifacts(state.branches.get(branch) ?? null);
    return artifacts.filter(function belongsToAttempt(artifact) {
        return attachmentMatchesAttempt(artifact, work, attempt);
    });
}
async function attachmentRunCoordinatorFinalize(
    state: AttachmentRunCoordinatorState,
    result: RunResult
): Promise<RunResult> {
    const { finalized, execution, server, store, resolved } = state;

    if (finalized.read() !== null) {
        return result;
    }
    const localErrors = await execution.finish();
    store.settleResult(result);
    const owners = await server.finish();
    const final = resultWithRuntimeAttachments(result, store.selectedArtifacts(), {
        localErrors,
        owners,
        policy: resolved.facts.execution.retries?.artifacts ?? 'first-failure-and-final',
        retainsBranch: store.retainsBranch
    });
    finalized.write(final);
    await store.prune(attachmentArtifacts(final.artifacts));
    return final;
}
async function attachmentRunCoordinatorClose(state: AttachmentRunCoordinatorState): Promise<void> {
    const { execution, server } = state;

    await execution.finish();
    await server.finish();
}
export function createAttachmentRunCoordinator(storage: AttachmentStorageSession): AttachmentRunCoordinator {
    const { store, server, resolved } = storage;
    const branches = new WeakMap<Record<string, unknown>, string>();
    const execution: AttachmentExecution = createAttachmentExecution(async function (operation) {
        return store.exchange('local', operation);
    }, server.endpoint.limits);
    const endpoint: AttachmentEndpoint = server.endpoint;
    const finalized = createStoredRunValue<RunResult | null>(null);
    const state: AttachmentRunCoordinatorState = {
        storage,
        store,
        server,
        resolved,
        branches,
        execution,
        endpoint,
        finalized
    };
    return {
        settleAttempt(work, attempt, verdict, branch) {
            store.settleAttempt(work, attempt, verdict, branch === null ? null : branches.get(branch) ?? null);
        },
        artifacts: store.selectedArtifacts,
        execution: state.execution,
        endpoint: state.endpoint,
        branchEndpoint: attachmentRunCoordinatorBranchEndpoint.bind(null, state),
        branchArtifacts: attachmentRunCoordinatorBranchArtifacts.bind(null, state),
        caseArtifacts: attachmentRunCoordinatorCaseArtifacts.bind(null, state),
        finalize: attachmentRunCoordinatorFinalize.bind(null, state),
        close: attachmentRunCoordinatorClose.bind(null, state)
    };
}
