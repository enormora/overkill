import { randomUUID } from 'node:crypto';
import { CaseRunnerError, type RunnerError } from '../engine/run-result.ts';
import type { WorkId } from '../engine/identity.ts';
import type { AttachmentOwner } from './attachment-protocol.ts';

type AttachmentFailureOptions = {
    readonly cause: unknown;
    readonly owner: AttachmentOwner;
    readonly drift: boolean;
    readonly subtype: 'artifact' | 'attribution-drift';
};
export class AttachmentOperationError extends CaseRunnerError {
    private consumed = false;
    private readonly owner: AttachmentOwner;
    private readonly drift: boolean;
    public constructor(message: string, options: AttachmentFailureOptions) {
        super(message, options);
        this.name = 'AttachmentOperationError';
        this.owner = options.drift ? { kind: 'run' } : options.owner;
        this.drift = options.drift;
    }

    public override runnerError(attributedTo: WorkId['case'], work: WorkId): RunnerError {
        this.consumed = true;
        return {
            ...super.runnerError(attributedTo, work),
            attributedTo: this.drift ? null : attributedTo,
            attributedToWork: this.drift ? null : work,
            attributedToAttempt: this.owner.kind === 'case' ? this.owner.attempt : null
        };
    }

    public take(): RunnerError | null {
        if (this.consumed) {
            return null;
        }
        this.consumed = true;
        return {
            attributedTo: this.owner.kind === 'case' ? this.owner.work.case : null,
            attributedToAttempt: this.owner.kind === 'case' ? this.owner.attempt : null,
            attributedToWork: this.owner.kind === 'case' ? this.owner.work : null,
            cause: this.cause,
            diagnostics: [],
            message: this.message,
            subtype: this.drift ? 'attribution-drift' : 'artifact'
        };
    }
}

export type AttachmentRejection = {
    readonly owner: AttachmentOwner;
    readonly message: string;
    readonly reason: string;
    readonly drift: boolean;
};
export function createAttachmentFailure(
    rejection: AttachmentRejection,
    branch: string | null
): AttachmentOperationError {
    const { owner, message, reason, drift } = rejection;
    return new AttachmentOperationError(message, {
        cause: { branch, id: randomUUID(), kind: 'runtime-attachment-error', owner, reason },
        drift,
        owner,
        subtype: drift ? 'attribution-drift' : 'artifact'
    });
}
export function attachmentFailureIdentity(error: RunnerError): string | null {
    const cause: unknown = error.cause;
    if (typeof cause !== 'object' || cause === null || Reflect.get(cause, 'kind') !== 'runtime-attachment-error') {
        return null;
    }
    const id: unknown = Reflect.get(cause, 'id');
    return typeof id === 'string' ? id : null;
}

export function attachmentFailureBranch(error: RunnerError): string | null {
    const cause: unknown = error.cause;
    if (attachmentFailureIdentity(error) === null || typeof cause !== 'object' || cause === null) {
        return null;
    }
    const branch: unknown = Reflect.get(cause, 'branch');
    return typeof branch === 'string' ? branch : null;
}
