import { appendRunnerErrors } from '../engine/execution-result.ts';
import { workIdentityKey, type WorkId, type AttemptId } from '../engine/identity.ts';
import { runStatusFromPlan, type RunResult, type RunnerError, type RunArtifact } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { attachmentFailureIdentity, attachmentFailureBranch } from './attachment-failure.ts';
import type { AttachmentOwner } from './attachment-protocol.ts';
import { retainedRetryArtifacts } from './retry-artifact-retention.ts';
import type { RetryArtifactPolicy } from './run-execution-config.ts';

function unclosedError(owner: AttachmentOwner): RunnerError {
    return {
        attributedTo: owner.kind === 'case' ? owner.work.case : null,
        attributedToAttempt: owner.kind === 'case' ? owner.attempt : null,
        attributedToWork: owner.kind === 'case' ? owner.work : null,
        cause: { owner, reason: 'unclosed' },
        diagnostics: [],
        message: 'Attachment writer did not close before its execution boundary ended.',
        subtype: 'artifact'
    };
}
export function attachmentArtifacts(artifacts: readonly RunArtifact[]): readonly RuntimeAttachmentArtifact[] {
    return artifacts.flatMap(function retainedAttachments(artifact) {
        const { id, payload, source } = artifact;
        if (
            payload.kind === 'runtime-attachment' && (id.subtype === 'attachment' || id.subtype === 'witness') &&
            source !== 'v8-native'
        ) {
            return [ { id: { ...id, subtype: id.subtype }, payload, source } ];
        }
        return artifact.payload.kind === 'hedged-conflict'
            ? [ ...artifact.payload.authoritative.attachments, ...artifact.payload.conflicting.attachments ]
            : [];
    });
}

export function attachmentMatchesAttempt(
    artifact: RuntimeAttachmentArtifact,
    work: WorkId,
    attempt: AttemptId
): boolean {
    if (artifact.id.scope.kind !== 'case' || artifact.id.attempt?.index !== attempt.index) {
        return false;
    }
    const identity: WorkId = {
        case: artifact.id.scope.case,
        runtimes: artifact.id.runtimes,
        workload: artifact.id.workload
    };
    return workIdentityKey(identity) === workIdentityKey(work);
}
export type AttachmentResultOptions = {
    readonly localErrors: readonly RunnerError[];
    readonly owners: readonly AttachmentOwner[];
    readonly policy: RetryArtifactPolicy;
    readonly retainsBranch: (branch: string | null) => boolean;
};
function distinctAttachmentErrors(errors: readonly RunnerError[]): readonly RunnerError[] {
    const ids = new Set<string>();
    return errors.filter(function distinctError(error) {
        const id = attachmentFailureIdentity(error);
        if (id === null) {
            return true;
        }
        if (ids.has(id)) {
            return false;
        }
        ids.add(id);
        return true;
    });
}
function retainedConflictEvidence(artifact: RunArtifact, policy: RetryArtifactPolicy): RunArtifact {
    const { payload } = artifact;
    if (payload.kind !== 'hedged-conflict') {
        return artifact;
    }
    const results = [ { workId: payload.work, attempts: payload.authoritative.attempts } ];
    const conflicting = [ { workId: payload.work, attempts: payload.conflicting.attempts } ];
    return {
        id: { ...artifact.id, subtype: 'hedged-conflict' },
        source: 'native',
        payload: {
            ...payload,
            authoritative: {
                ...payload.authoritative,
                attachments: retainedRetryArtifacts(payload.authoritative.attachments, results, policy)
            },
            conflicting: {
                ...payload.conflicting,
                attachments: retainedRetryArtifacts(payload.conflicting.attachments, conflicting, policy)
            }
        }
    };
}
function retainedAttachmentErrors(
    errors: readonly RunnerError[],
    retains: AttachmentResultOptions['retainsBranch']
): readonly RunnerError[] {
    return distinctAttachmentErrors(errors.filter(function belongsToRetainedBranch(error) {
        return retains(attachmentFailureBranch(error));
    }));
}

export function resultWithRuntimeAttachments(
    result: RunResult,
    attachments: readonly RuntimeAttachmentArtifact[],
    options: AttachmentResultOptions
): RunResult {
    const artifacts = retainedRetryArtifacts(attachments, result.perTest, options.policy);
    const existing = new Set(
        result
            .artifacts
            .filter(function attachment(artifact) {
                return artifact.id.subtype === 'attachment' || artifact.id.subtype === 'witness';
            })
            .map(function sequence(artifact) {
                return artifact.id.sequence;
            })
    );
    const additions = artifacts.filter(function newAttachment(artifact) {
        return !existing.has(artifact.id.sequence);
    });
    const runnerErrors = retainedAttachmentErrors(result.runnerErrors, options.retainsBranch);
    return appendRunnerErrors({
        ...result,
        status: runStatusFromPlan(result.summary, runnerErrors, result.planStatus),
        runnerErrors,
        artifacts: [
            ...result.artifacts.map(function retainConflict(artifact) {
                return retainedConflictEvidence(artifact, options.policy);
            }),
            ...additions
        ]
    }, [
        ...retainedAttachmentErrors(options.localErrors, options.retainsBranch),
        ...options.owners.map(unclosedError)
    ]);
}
