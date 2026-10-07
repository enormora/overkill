import { workIdentityKey, type WorkId, type AttemptId } from '../engine/identity.ts';
import type { RunResult, TestVerdict } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact, FailureArtifactCondition } from '../engine/runtime-attachment.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';

type FailureCapture = {
    readonly channel: string;
    readonly branch: string | null;
    readonly artifact: () => RuntimeAttachmentArtifact;
};
type FailureRetentionState = {
    readonly verdicts: {
        readonly get: (key: string) => TestVerdict | undefined;
        readonly set: (key: string, verdict: TestVerdict) => void;
        readonly [Symbol.iterator]: () => IterableIterator<readonly [string, TestVerdict]>;
    };
    readonly resourceFailures: {
        readonly has: (key: string) => boolean;
        readonly add: (key: string) => unknown;
    };
    readonly consumers: {
        readonly get: (key: string) => ReadonlySet<string> | undefined;
        readonly set: (key: string, consumers: ReadonlySet<string>) => void;
    };
    readonly failedRun: StoredValue<boolean>;
    readonly interruptedRun: StoredValue<boolean>;
};
function isFailureVerdict(verdict: TestVerdict | undefined): boolean {
    return verdict !== undefined && verdict !== 'pass' && verdict !== 'skip';
}
function interruptedArtifact(artifact: RuntimeAttachmentArtifact): boolean {
    const { content } = artifact.payload;
    return (content.kind === 'text' || content.kind === 'file') && content.completion.kind === 'incomplete' &&
        content.completion.reason === 'interrupted';
}
function attemptEvidenceRetained(
    state: FailureRetentionState,
    writer: FailureCapture,
    condition: Extract<FailureArtifactCondition, { readonly kind: 'attempt'; }>
): boolean {
    const key = `${workIdentityKey(condition.work)}:${condition.attempt.index}`;
    const verdict = state.verdicts.get(`${writer.branch}:${key}`) ?? state.verdicts.get(`null:${key}`);
    if (verdict !== undefined) {
        return isFailureVerdict(verdict);
    }
    return state.failedRun.read() && (state.interruptedRun.read() || interruptedArtifact(writer.artifact()));
}
function consumerEvidenceRetained(state: FailureRetentionState, branch: string | null, work: string): boolean {
    const prefix = `${branch}:${work}:`;
    const verdicts = Array.from(state.verdicts).filter(function matchingConsumer([ key ]) {
        return key.startsWith(prefix);
    });
    return verdicts.some(function failedAttempt(entry) {
        return isFailureVerdict(entry[1]);
    }) || verdicts.length === 0 && state.interruptedRun.read();
}
function failureArtifactRetained(state: FailureRetentionState, writer: FailureCapture): boolean {
    const artifact = writer.artifact();
    if (artifact.payload.capture !== 'automatic') {
        return true;
    }
    const { condition } = artifact.payload.retention;
    if (condition.kind === 'attempt') {
        return attemptEvidenceRetained(state, writer, condition);
    }
    return state.resourceFailures.has(`${writer.channel}:${condition.boundary}`) ||
        Array.from(state.consumers.get(`${writer.channel}:${condition.boundary}`) ?? []).some(
            function failedConsumer(work) {
                return consumerEvidenceRetained(state, writer.branch, work);
            }
        );
}

export type FailureArtifactRetention = {
    readonly consume: (channel: string, boundary: string, work: WorkId) => void;
    readonly markResourceFailure: (channel: string, boundary: string) => void;
    readonly settleAttempt: (work: WorkId, attempt: AttemptId, verdict: TestVerdict, branch: string | null) => void;
    readonly settleResult: (result: RunResult) => void;
    readonly retains: (capture: FailureCapture) => boolean;
    readonly interrupted: () => boolean;
};
export function createFailureArtifactRetention(): FailureArtifactRetention {
    const state: FailureRetentionState = {
        verdicts: new Map(),
        resourceFailures: new Set(),
        consumers: new Map(),
        failedRun: createStoredValue(false),
        interruptedRun: createStoredValue(false)
    };
    return {
        consume(channel, boundary, work) {
            const key = `${channel}:${boundary}`;
            state.consumers.set(key, new Set([ ...state.consumers.get(key) ?? [], workIdentityKey(work) ]));
        },
        markResourceFailure(channel, boundary) {
            state.resourceFailures.add(`${channel}:${boundary}`);
        },
        settleAttempt(work, attempt, verdict, branch) {
            state.verdicts.set(`${branch}:${workIdentityKey(work)}:${attempt.index}`, verdict);
        },
        settleResult(result) {
            state.failedRun.write(result.status === 'failed');
            state.interruptedRun.write(result.runnerErrors.some(function ownerCrash(error) {
                return error.subtype === 'crash' || error.subtype === 'resource-exhaustion';
            }));
            for (const entry of result.perTest) {
                for (const attempt of entry.attempts) {
                    state.verdicts.set(
                        `null:${workIdentityKey(entry.workId)}:${attempt.attempt.index}`,
                        attempt.verdict
                    );
                }
            }
        },
        retains: failureArtifactRetained.bind(null, state),
        interrupted: state.interruptedRun.read
    };
}
