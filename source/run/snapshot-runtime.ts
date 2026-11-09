import type { TestRuntimePolicy } from '../engine/case-execution-context.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { RunnerError } from './run-engine-primitives.ts';
import type { SnapshotRun } from './snapshot-wire.ts';
import { runWithSnapshotRun } from './execution-session-context.ts';
import { isSnapshotExecutionError, snapshotRunnerError } from './snapshot-error.ts';

export function snapshotRuntimePolicy(
    policy: TestRuntimePolicy | null,
    wire: SnapshotRun | null
): TestRuntimePolicy | null {
    if (policy === null || wire === null) {
        return policy;
    }
    const errors = new Map<string, RunnerError>();
    return {
        ...policy,
        async runAttempt(testCase, attempt, run) {
            try {
                return await runWithSnapshotRun(wire, async function executeSnapshotPolicy() {
                    return await policy.runAttempt(testCase, attempt, run);
                });
            } catch (error: unknown) {
                if (isSnapshotExecutionError(error)) {
                    errors.set(
                        `${workIdentityKey(testCase.workId)}:${attempt.index}`,
                        snapshotRunnerError(error, testCase.workId, attempt)
                    );
                }
                throw error;
            }
        },
        takeAttemptErrors(testCase, attempt) {
            const key = `${workIdentityKey(testCase.workId)}:${attempt.index}`;
            const error = errors.get(key);
            errors.delete(key);
            return [ ...policy.takeAttemptErrors(testCase, attempt), ...error === undefined ? [] : [ error ] ];
        },
        takeRunErrors() {
            const pending = Array.from(errors.values());
            errors.clear();
            return [ ...policy.takeRunErrors(), ...pending ];
        }
    };
}
