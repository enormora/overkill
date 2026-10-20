import diagnosticsChannel from 'node:diagnostics_channel';
import { workIdentityKey } from '../engine/identity.ts';
import {
    permissionDeniedRunnerErrorFromDiagnostic,
    type PermissionDeniedRunnerErrorPhase,
    type RunnerError
} from '../engine/run-result.ts';
import { createExecutionObservation, type ExecutionObservation } from '../engine/execution-observation.ts';
import type { TestRuntimePolicy } from '../engine/case-execution.ts';

const permissionDiagnosticsCapabilities: Readonly<Record<string, string>> = {
    'node:permission-model:child': 'child-process',
    'node:permission-model:ffi': 'worker',
    'node:permission-model:fs': 'fs-read',
    'node:permission-model:inspector': 'inspector',
    'node:permission-model:net': 'net',
    'node:permission-model:openssl-store': 'openssl-store',
    'node:permission-model:wasi': 'wasi',
    'node:permission-model:worker': 'worker'
};

function permissionDiagnosticsPhase(loadComplete: boolean): PermissionDeniedRunnerErrorPhase {
    return loadComplete ? 'out-of-test' : 'load';
}

function permissionWasDropped(message: unknown): boolean {
    return typeof message === 'object' && message !== null && Reflect.get(message, 'drop') === true;
}

function ignorePermissionDropDiagnostics(
    recordDiagnostic: (message: unknown) => void
): (message: unknown) => void {
    return function recordPermissionDenial(message): void {
        if (!permissionWasDropped(message)) {
            recordDiagnostic(message);
        }
    };
}

export function createPermissionDiagnosticsSubscriptions(
    observation: ExecutionObservation,
    phase: () => PermissionDeniedRunnerErrorPhase,
    recordError: (error: RunnerError) => void
): void {
    for (const [ name, capability ] of Object.entries(permissionDiagnosticsCapabilities)) {
        const channel = diagnosticsChannel.channel(name);
        const listener = ignorePermissionDropDiagnostics(function recordDiagnostic(message: unknown): void {
            if (!observation.accepts()) {
                return;
            }
            const error = permissionDeniedRunnerErrorFromDiagnostic({
                channel: name,
                fallbackCapability: capability,
                message
            }, {
                attributedTo: null,
                attributedToWork: null,
                boundary: null,
                diagnosticChannel: name,
                hook: null,
                phase: observation.hasActiveAttempt() ? 'body' : phase()
            });
            recordError(observation.attribute(error));
        });
        channel.subscribe(listener);

        observation.register(function stopPermissionDiagnostic() {
            channel.unsubscribe(listener);
        });
    }
}

function tryRecordPermissionError(record: (error: RunnerError) => void, error: RunnerError): void {
    try {
        record(error);
    } catch {
    }
}

export function createPermissionDenialRuntimePolicy(): TestRuntimePolicy {
    const observation = createExecutionObservation();
    const caseErrors = new Map<string, RunnerError[]>();
    const runErrors: RunnerError[] = [];
    let loadComplete = false;
    const record = function recordError(error: RunnerError): void {
        if (
            error.attributedToWork === null || error.attributedToWork === undefined ||
            error.attributedToAttempt === null
        ) {
            runErrors.push(error);
            return;
        }
        const key = `${workIdentityKey(error.attributedToWork)}:${error.attributedToAttempt.index}`;
        caseErrors.set(key, [ ...caseErrors.get(key) ?? [], error ]);
    };
    createPermissionDiagnosticsSubscriptions(
        observation,
        function currentPermissionDiagnosticsPhase() {
            return permissionDiagnosticsPhase(loadComplete);
        },
        function recordWithoutThrowing(error) {
            tryRecordPermissionError(record, error);
        }
    );

    return {
        async prepareAttempt() {
            return undefined;
        },
        async completeCase() {
            return undefined;
        },
        async runAttempt(testCase, attempt, run) {
            loadComplete = true;

            return await observation.runAttempt(testCase, attempt, run);
        },
        async runLoad(run) {
            try {
                return await observation.run(run);
            } finally {
                loadComplete = true;
            }
        },
        takeAttemptErrors(testCase, attempt) {
            const key = `${workIdentityKey(testCase.workId)}:${attempt.index}`;
            const errors = caseErrors.get(key) ?? [];
            caseErrors.delete(key);

            return errors;
        },
        takePendingRunErrors() {
            const errors = Array.from(runErrors);
            runErrors.length = 0;

            return errors;
        },
        takeRunErrors() {
            observation.stop();

            const errors = Array.from(runErrors);
            runErrors.length = 0;

            return errors;
        }
    };
}
