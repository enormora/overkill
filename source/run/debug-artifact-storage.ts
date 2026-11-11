import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { appendRunnerErrors } from '../engine/execution-result.ts';
import { recordUndeliveredRunnerError } from '../engine/reporter-error-delivery-tracking.ts';
import { withRunnerInfrastructure } from '../engine/execution-observation.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { isTestDebugArtifact, type RunArtifact, type RunnerError, type RunResult } from '../engine/run-result.ts';
import type { TestDebugArtifact } from '../engine/run-artifact.ts';
import type { RuntimeStateStore } from './history-storage-types.ts';

export type DebugArtifactStore = {
    readonly persist: (artifacts: readonly RunArtifact[]) => Promise<readonly RunnerError[]>;
};
function debugArtifactPath(directory: string, artifact: TestDebugArtifact): string {
    const identity = workIdentityKey({
        familyVariant: artifact.id.familyVariant,
        case: artifact.id.scope.case,
        runtimes: artifact.id.runtimes,
        workload: artifact.id.workload
    });
    const name = createHash('sha256').update(identity).digest('hex');
    const placement = artifact.id.sequence === 0 ? '' : `__placement=${artifact.id.sequence.toString()}`;
    return join(directory, `${name}__attempt=${artifact.id.attempt.index.toString()}${placement}.debug.json`);
}
function debugWriteFailure(artifact: TestDebugArtifact, path: string, error: unknown): RunnerError {
    return {
        subtype: 'artifact',
        message: `Failed to persist debug artifact: ${path}`,
        cause: error,
        attributedTo: artifact.id.scope.case,
        attributedToWork: {
            familyVariant: artifact.id.familyVariant,
            case: artifact.id.scope.case,
            runtimes: artifact.id.runtimes,
            workload: artifact.id.workload
        },
        attributedToAttempt: artifact.id.attempt,
        diagnostics: [ { label: 'Debug artifact path', value: path } ]
    };
}
export function createDebugArtifactStore(
    directory: string,
    store: Pick<RuntimeStateStore, 'write'>
): DebugArtifactStore {
    const persisted = new Map<string, string>();
    async function persistArtifact(artifact: TestDebugArtifact): Promise<RunnerError | null> {
        const captured = { path: debugArtifactPath(directory, artifact), content: `${JSON.stringify(artifact)}\n` };
        const fingerprint = createHash('sha256').update(captured.content).digest('hex');
        if (persisted.get(captured.path) === fingerprint) {
            return null;
        }
        try {
            await store.write(captured.path, captured.content);
            persisted.set(captured.path, fingerprint);
            return null;
        } catch (error: unknown) {
            return debugWriteFailure(artifact, captured.path, error);
        }
    }
    return {
        async persist(artifacts) {
            const errors: RunnerError[] = [];
            for (const artifact of artifacts) {
                const failure = isTestDebugArtifact(artifact) ? await persistArtifact(artifact) : null;
                if (failure !== null) {
                    errors.push(failure);
                }
            }
            return errors;
        }
    };
}

export async function persistDebugResult(
    result: RunResult,
    store: DebugArtifactStore,
    completed: boolean
): Promise<RunResult> {
    const errors = await withRunnerInfrastructure(async function persistDebugArtifacts() {
        return await store.persist(result.artifacts);
    });
    if (completed) {
        for (const error of errors) {
            recordUndeliveredRunnerError(error);
        }
    }
    return appendRunnerErrors(result, errors);
}
