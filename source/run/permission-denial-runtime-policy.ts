import { AsyncLocalStorage } from 'node:async_hooks';
import diagnosticsChannel from 'node:diagnostics_channel';
import { workIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import {
    permissionDeniedRunnerErrorFromDiagnostic,
    type PermissionDeniedRunnerErrorPhase,
    type RunnerError
} from '../engine/run-result.ts';
import type { TestRuntimePolicy } from '../engine/case-execution.ts';

export type PermissionRuntimeActiveCase = {
    readonly id: CaseId;
    readonly key: string;
    readonly workId: WorkId;
};

type Subscription = {
    readonly unsubscribe: () => void;
};

type PermissionErrorStore = {
    readonly recordCaseError: (key: string, error: RunnerError) => void;
    readonly recordRunError: (error: RunnerError) => void;
};

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

export function createPermissionDiagnosticsSubscriptions(
    activeCaseStorage: AsyncLocalStorage<PermissionRuntimeActiveCase>,
    phase: () => PermissionDeniedRunnerErrorPhase,
    recordError: (error: RunnerError) => void
): readonly Subscription[] {
    return Object.entries(permissionDiagnosticsCapabilities).map(function subscribeToPermissionChannel(
        [ name, capability ]
    ) {
        const channel = diagnosticsChannel.channel(name);
        const listener = function recordDiagnostic(message: unknown): void {
            const activeCase = activeCaseStorage.getStore();

            recordError(permissionDeniedRunnerErrorFromDiagnostic({
                channel: name,
                fallbackCapability: capability,
                message
            }, {
                attributedTo: activeCase?.id ?? null,
                attributedToWork: activeCase?.workId ?? null,
                boundary: null,
                diagnosticChannel: name,
                hook: null,
                phase: activeCase === undefined ? phase() : 'body'
            }));
        };
        channel.subscribe(listener);

        return {
            unsubscribe() {
                channel.unsubscribe(listener);
            }
        };
    });
}

function recordPermissionError(
    activeCaseStorage: AsyncLocalStorage<PermissionRuntimeActiveCase>,
    store: PermissionErrorStore,
    error: RunnerError
): void {
    const activeCase = activeCaseStorage.getStore();

    if (activeCase === undefined) {
        store.recordRunError(error);
        return;
    }

    store.recordCaseError(activeCase.key, error);
}

function tryRecordPermissionError(record: (error: RunnerError) => void, error: RunnerError): void {
    try {
        record(error);
    } catch {
    }
}

export function createPermissionDenialRuntimePolicy(): TestRuntimePolicy {
    const activeCaseStorage = new AsyncLocalStorage<PermissionRuntimeActiveCase>();
    const caseErrors = new Map<string, RunnerError[]>();
    const runErrors: RunnerError[] = [];
    const store = {
        recordCaseError(key: string, error: RunnerError) {
            caseErrors.set(key, [ ...caseErrors.get(key) ?? [], error ]);
        },
        recordRunError(error: RunnerError) {
            runErrors.push(error);
        }
    };
    let loadComplete = false;
    const record = function recordError(error: RunnerError): void {
        recordPermissionError(activeCaseStorage, store, error);
    };
    const subscriptions = createPermissionDiagnosticsSubscriptions(
        activeCaseStorage,
        function currentPermissionDiagnosticsPhase() {
            return permissionDiagnosticsPhase(loadComplete);
        },
        function recordWithoutThrowing(error) {
            tryRecordPermissionError(record, error);
        }
    );

    return {
        async runCase(testCase, run) {
            loadComplete = true;

            return await activeCaseStorage.run({
                id: testCase.id,
                key: workIdentityKey(testCase.workId),
                workId: testCase.workId
            }, run);
        },
        async runLoad(run) {
            try {
                return await run();
            } finally {
                loadComplete = true;
            }
        },
        takeCaseErrors(testCase) {
            const key = workIdentityKey(testCase.workId);
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
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }

            const errors = Array.from(runErrors);
            runErrors.length = 0;

            return errors;
        }
    };
}
