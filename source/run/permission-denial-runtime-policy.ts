import diagnosticsChannel from 'node:diagnostics_channel';
import { workIdentityKey } from '../engine/identity.ts';
import {
    permissionDeniedRunnerErrorFromDiagnostic,
    type PermissionDeniedRunnerError,
    type PermissionDeniedRunnerErrorPhase,
    type RunnerError
} from '../engine/run-result.ts';
import { createExecutionObservation, type ExecutionObservation } from '../engine/execution-observation.ts';
import type { TestRuntimePolicy } from '../engine/case-execution-context.ts';
import { readProcessEnvironment } from './node-host-readers.ts';

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

export function permissionAuditEnabled(nodeArguments: readonly string[], nodeOptions: string): boolean {
    const environmentArguments = (nodeOptions.match(/(?:[^ "]|"(?:[^"\\]|\\.)*")+/gu) ?? [])
        .map(function unquoteArgument(argument) {
            return argument.replaceAll(/"(?<value>(?:[^"\\]|\\.)*)"/gu, function unquote(_match, value: string) {
                return value.replaceAll(/\\(?<escaped>.)/gu, '$<escaped>');
            });
        });
    const auditOption = [ ...environmentArguments, ...nodeArguments ]
        .map(function normalizeOption(argument) {
            return argument.split('=', 1)[0]?.replaceAll('_', '-');
        })
        .findLast(function changesAuditMode(argument) {
            return argument === '--permission-audit' || argument === '--no-permission-audit';
        });

    return auditOption === '--permission-audit';
}

function permissionDiagnosticsPhase(loadComplete: boolean): PermissionDeniedRunnerErrorPhase {
    return loadComplete ? 'out-of-test' : 'load';
}

function isAuditedBootstrapRead(error: PermissionDeniedRunnerError): boolean {
    return error.cause.phase !== 'body' && error.cause.capability === 'fs-read' &&
        permissionAuditEnabled(process.execArgv, readProcessEnvironment(process).NODE_OPTIONS ?? '');
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
    recordError: (error: RunnerError) => void,
    auditDiagnostics: 'ignore' | 'report'
): void {
    if (
        auditDiagnostics === 'ignore' &&
        permissionAuditEnabled(process.execArgv, readProcessEnvironment(process).NODE_OPTIONS ?? '')
    ) {
        return;
    }

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
            if (!isAuditedBootstrapRead(error)) {
                recordError(observation.attribute(error));
            }
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
        },
        'ignore'
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
