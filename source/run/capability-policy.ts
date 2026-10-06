import asyncHooks, { AsyncLocalStorage } from 'node:async_hooks';
import diagnosticsChannel from 'node:diagnostics_channel';
import { workIdentityKey, type AttemptId, type CaseId, type WorkId } from '../engine/identity.ts';
import { recordReporterConsoleDiagnostic } from '../engine/reporter-output-scope.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { TestRuntimePolicy } from '../engine/case-execution.ts';
import {
    createPermissionDenialRuntimePolicy as createPermissionDenialRuntimePolicyCore,
    createPermissionDiagnosticsSubscriptions
} from './permission-denial-runtime-policy.ts';
import {
    environmentChanged,
    localStorageChanged,
    sessionStorageChanged,
    takeSnapshots,
    type RuntimeCapabilityPolicyDependencies,
    type RuntimeSnapshots
} from './capability-policy-snapshots.ts';

export type RuntimeCapabilityPolicy = TestRuntimePolicy & {
    readonly recordViolation: (
        capability: RuntimePolicyCapability,
        message: string,
        strictness: RuntimePolicyStrictness
    ) => void;
};

const runtimePolicyCapabilities = {
    childProcess: 'child-process',
    console: 'console',
    cryptoRandom: 'crypto-random',
    dynamicModuleLoad: 'dynamic-module-load',
    fileRead: 'fs-read',
    fileWrite: 'fs-write',
    inspector: 'inspector',
    network: 'net',
    openSslStore: 'openssl-store',
    processEnvironment: 'process-env',
    processExecute: 'process-execute',
    rawStderr: 'raw-stderr',
    rawStdout: 'raw-stdout',
    timer: 'timer',
    wasi: 'wasi',
    webLocks: 'web-locks',
    worker: 'worker'
} as const;

type RuntimePolicyCapability = typeof runtimePolicyCapabilities[keyof typeof runtimePolicyCapabilities];

type RuntimePolicyPhase = 'body' | 'load' | 'out-of-test';
type RuntimePolicyStrictness = 'blocked' | 'observed';

export type CapabilityPolicyOptions = {
    readonly dependencies: RuntimeCapabilityPolicyDependencies;
    readonly observedStderr: boolean;
    readonly observedStdout: boolean;
};

type ActiveCase = {
    readonly attempt: AttemptId;
    readonly id: CaseId;
    readonly key: string;
    readonly workId: WorkId;
};

type RuntimePolicyViolation = {
    readonly capability: RuntimePolicyCapability;
    readonly caseId: CaseId | null;
    readonly message: string;
    readonly phase: RuntimePolicyPhase;
    readonly strictness: RuntimePolicyStrictness;
    readonly workId: WorkId | null;
};

type RuntimePolicyReport = {
    readonly capability: RuntimePolicyCapability;
    readonly message: string;
    readonly strictness: RuntimePolicyStrictness;
};

type Subscription = {
    readonly unsubscribe: () => void;
};

type AsyncResourceHook = {
    readonly disable: () => void;
    readonly enable: () => void;
};

type RuntimePolicyMonitoring = {
    readonly hook: AsyncResourceHook;
    readonly stopObservingProcess: () => void;
    readonly subscriptions: readonly Subscription[];
};

const asyncFileResourceTypes = new Set([
    'FILEHANDLE',
    'FILEHANDLECLOSEREQ',
    `${[ 'FS', 'REQ' ].join('')}CALLBACK`,
    `${[ 'FS', 'REQ' ].join('')}PROMISE`
]);
const processExecuteChannel = [ 'process.', 'exec', 've' ].join('');
const randomResourceReport: RuntimePolicyReport = {
    capability: runtimePolicyCapabilities.cryptoRandom,
    message: 'Runtime policy violation: asynchronous random resource.',
    strictness: 'observed'
};
const staticAsyncResourceReports: Readonly<Record<string, RuntimePolicyReport>> = {
    RANDOMBYTESREQUEST: randomResourceReport,
    RANDOMPRIMEREQUEST: randomResourceReport,
    WORKER: {
        capability: runtimePolicyCapabilities.worker,
        message: 'Runtime policy violation: worker resource created.',
        strictness: 'observed'
    }
};

const diagnosticsCapabilities: Readonly<Record<string, RuntimePolicyCapability>> = {
    'console.debug': runtimePolicyCapabilities.console,
    'console.error': runtimePolicyCapabilities.console,
    'console.info': runtimePolicyCapabilities.console,
    'console.log': runtimePolicyCapabilities.console,
    'console.warn': runtimePolicyCapabilities.console,
    'http.client.request.created': runtimePolicyCapabilities.network,
    'http.client.request.error': runtimePolicyCapabilities.network,
    'http.client.request.start': runtimePolicyCapabilities.network,
    'locks.request.end': runtimePolicyCapabilities.webLocks,
    'locks.request.grant': runtimePolicyCapabilities.webLocks,
    'locks.request.miss': runtimePolicyCapabilities.webLocks,
    'locks.request.start': runtimePolicyCapabilities.webLocks,
    'net.client.socket': runtimePolicyCapabilities.network,
    [processExecuteChannel]: runtimePolicyCapabilities.processExecute,
    'tracing:module.import:asyncStart': runtimePolicyCapabilities.dynamicModuleLoad,
    'tracing:module.import:start': runtimePolicyCapabilities.dynamicModuleLoad,
    'tracing:module.require:start': runtimePolicyCapabilities.dynamicModuleLoad,
    'udp.socket': runtimePolicyCapabilities.network,
    worker_threads: runtimePolicyCapabilities.worker
};

function asyncResourceReport(
    type: string,
    hasActiveCase: boolean
): RuntimePolicyReport | null {
    if (type === 'Timeout' && hasActiveCase) {
        return {
            capability: runtimePolicyCapabilities.timer,
            message: 'Runtime policy violation: setTimeout/setInterval created a timer.',
            strictness: 'observed'
        };
    }

    if (asyncFileResourceTypes.has(type)) {
        return {
            capability: runtimePolicyCapabilities.fileRead,
            message: `Runtime policy violation: asynchronous file resource ${type}.`,
            strictness: 'observed'
        };
    }

    return staticAsyncResourceReports[type] ?? null;
}

function createAsyncResourceHook(
    activeCaseStorage: AsyncLocalStorage<ActiveCase>,
    recordViolation: (violation: RuntimePolicyReport) => void
): AsyncResourceHook {
    const createHookKey = 'createHook';
    const createHook = asyncHooks[createHookKey];

    return createHook({
        init(_asyncId, type) {
            const report = asyncResourceReport(type, activeCaseStorage.getStore() !== undefined);

            if (report !== null) {
                recordViolation(report);
            }
        }
    });
}

function runtimePolicyError(violation: RuntimePolicyViolation): RunnerError {
    return {
        attributedToAttempt: null,
        attributedTo: violation.caseId,
        attributedToWork: violation.workId,
        cause: violation,
        diagnostics: [
            { label: 'capability', value: violation.capability },
            { label: 'phase', value: violation.phase },
            { label: 'strictness', value: violation.strictness }
        ],
        message: violation.message,
        subtype: 'runtime-policy'
    };
}

function ignoredLoadCapability(capability: RuntimePolicyCapability): boolean {
    return capability === runtimePolicyCapabilities.dynamicModuleLoad ||
        capability === runtimePolicyCapabilities.fileRead;
}

function ignoredViolation(
    violation: RuntimePolicyReport,
    activeCase: ActiveCase | undefined,
    loadComplete: boolean
): boolean {
    return activeCase === undefined &&
        (
            violation.capability === runtimePolicyCapabilities.fileRead ||
            !loadComplete && ignoredLoadCapability(violation.capability)
        );
}

function violationPhase(activeCase: ActiveCase | undefined, loadComplete: boolean): RuntimePolicyPhase {
    if (activeCase !== undefined) {
        return 'body';
    }

    return loadComplete ? 'out-of-test' : 'load';
}

function createDiagnosticsSubscriptions(
    recordViolation: (violation: RuntimePolicyReport) => void
): readonly Subscription[] {
    return Object.entries(diagnosticsCapabilities).map(function subscribeToChannel([ name, capability ]) {
        const channel = diagnosticsChannel.channel(name);
        const listener = function recordDiagnostic(): void {
            if (recordReporterConsoleDiagnostic(name)) {
                return;
            }

            recordViolation({
                capability,
                message: `Runtime policy violation: ${capability}.`,
                strictness: 'observed'
            });
        };
        channel.subscribe(listener);

        return {
            unsubscribe() {
                channel.unsubscribe(listener);
            }
        };
    });
}

function recordSnapshotChanges(
    before: RuntimeSnapshots,
    dependencies: RuntimeCapabilityPolicyDependencies,
    record: (violation: RuntimePolicyReport) => void
): void {
    const after = takeSnapshots(dependencies);

    if (environmentChanged(before, after)) {
        record({
            capability: runtimePolicyCapabilities.processEnvironment,
            message: 'Runtime policy violation: process.env changed.',
            strictness: 'observed'
        });
    }

    if (sessionStorageChanged(before, after)) {
        record({
            capability: runtimePolicyCapabilities.fileWrite,
            message: 'Runtime policy violation: sessionStorage changed.',
            strictness: 'observed'
        });
    }

    if (localStorageChanged(before, after)) {
        record({
            capability: runtimePolicyCapabilities.fileWrite,
            message: 'Runtime policy violation: localStorage changed.',
            strictness: 'observed'
        });
    }
}

function observeRuntimeProcessEvents(
    dependencies: RuntimeCapabilityPolicyDependencies,
    record: (violation: RuntimePolicyReport) => RunnerError
): () => void {
    const stopObservingExit = dependencies.observeProcessExit(
        function recordProcessExecutionViolation(message) {
            return record({
                capability: runtimePolicyCapabilities.processExecute,
                message,
                strictness: 'observed'
            });
        }
    );
    const stopObservingIpc = dependencies.observeIpcListeners(function recordIpcViolation(message) {
        record({
            capability: runtimePolicyCapabilities.childProcess,
            message,
            strictness: 'observed'
        });
    });

    return function stopObservingRuntimeProcess(): void {
        stopObservingIpc();
        stopObservingExit();
    };
}

function startRuntimePolicyMonitoring(
    activeCaseStorage: AsyncLocalStorage<ActiveCase>,
    record: (violation: RuntimePolicyReport) => RunnerError,
    dependencies: RuntimeCapabilityPolicyDependencies
): RuntimePolicyMonitoring {
    function recordObservedViolation(violation: RuntimePolicyReport): void {
        try {
            record(violation);
        } catch {
        }
    }
    const subscriptions = createDiagnosticsSubscriptions(recordObservedViolation);
    const hook = createAsyncResourceHook(activeCaseStorage, recordObservedViolation);
    const stopObservingProcess = observeRuntimeProcessEvents(dependencies, record);

    hook.enable();

    return { hook, stopObservingProcess, subscriptions };
}

function stopRuntimePolicyMonitoring(monitoring: RuntimePolicyMonitoring): void {
    monitoring.hook.disable();
    monitoring.stopObservingProcess();

    for (const subscription of monitoring.subscriptions) {
        subscription.unsubscribe();
    }
}

function rawOutputPolicyError(capability: RuntimePolicyCapability, message: string): RunnerError {
    return runtimePolicyError({
        capability,
        caseId: null,
        message,
        phase: 'out-of-test',
        strictness: 'observed',
        workId: null
    });
}

function rawOutputPolicyErrors(options: CapabilityPolicyOptions): readonly RunnerError[] {
    const errors: RunnerError[] = [];
    if (options.observedStdout) {
        errors.push(rawOutputPolicyError('raw-stdout', 'Runtime policy violation: unexpected stdout output.'));
    }
    if (options.observedStderr) {
        errors.push(rawOutputPolicyError('raw-stderr', 'Runtime policy violation: unexpected stderr output.'));
    }
    return errors;
}

function completedRuntimePolicyViolation(
    violation: RuntimePolicyReport,
    activeCase: ActiveCase | undefined,
    loadComplete: boolean
): RuntimePolicyViolation {
    return {
        ...violation,
        caseId: activeCase?.id ?? null,
        workId: activeCase?.workId ?? null,
        phase: violationPhase(activeCase, loadComplete)
    };
}

function permissionDiagnosticsPhase(loadComplete: boolean): RuntimePolicyPhase {
    return loadComplete ? 'out-of-test' : 'load';
}

export const createPermissionDenialRuntimePolicy: () => TestRuntimePolicy = createPermissionDenialRuntimePolicyCore;

export function createRuntimeCapabilityPolicy(options: CapabilityPolicyOptions): RuntimeCapabilityPolicy {
    const activeCaseStorage = new AsyncLocalStorage<ActiveCase>();
    const caseErrors = new Map<string, RunnerError[]>();
    const runErrors: RunnerError[] = [];
    const lifecycle = { loadComplete: false, stopped: false };

    function record(violation: RuntimePolicyReport): RunnerError {
        const activeCase = activeCaseStorage.getStore();

        const completedViolation = completedRuntimePolicyViolation(violation, activeCase, lifecycle.loadComplete);
        const error = { ...runtimePolicyError(completedViolation), attributedToAttempt: activeCase?.attempt ?? null };

        if (!ignoredViolation(violation, activeCase, lifecycle.loadComplete)) {
            if (activeCase === undefined) {
                runErrors.push(error);
            } else {
                caseErrors.set(activeCase.key, [ ...caseErrors.get(activeCase.key) ?? [], error ]);
            }
        }

        return error;
    }

    function recordPermissionError(error: RunnerError): void {
        const activeCase = activeCaseStorage.getStore();

        if (activeCase === undefined) {
            runErrors.push(error);
            return;
        }

        caseErrors.set(activeCase.key, [ ...caseErrors.get(activeCase.key) ?? [], error ]);
    }

    function recordWithoutReturning(violation: RuntimePolicyReport): void {
        record(violation);
    }

    const monitoring = startRuntimePolicyMonitoring(activeCaseStorage, record, options.dependencies);
    const permissionDiagnosticsSubscriptions = createPermissionDiagnosticsSubscriptions(
        activeCaseStorage,
        function currentPermissionDiagnosticsPhase() {
            return permissionDiagnosticsPhase(lifecycle.loadComplete);
        },
        function recordPermissionErrorWithoutThrowing(error) {
            try {
                recordPermissionError(error);
            } catch {
            }
        }
    );

    return {
        recordViolation(capability, message, strictness) {
            record({ capability, message, strictness });
        },
        async completeCase() {
            return undefined;
        },
        async runAttempt(testCase, attempt, run) {
            lifecycle.loadComplete = true;
            const activeCase = {
                attempt,
                id: testCase.id,
                key: `${workIdentityKey(testCase.workId)}:${attempt.index}`,
                workId: testCase.workId
            };
            const before = takeSnapshots(options.dependencies);

            try {
                return await activeCaseStorage.run(activeCase, run);
            } finally {
                activeCaseStorage.run(activeCase, function recordCaseSnapshotChanges() {
                    recordSnapshotChanges(before, options.dependencies, recordWithoutReturning);
                });
            }
        },
        async runLoad(run) {
            const before = takeSnapshots(options.dependencies);

            try {
                return await run();
            } finally {
                recordSnapshotChanges(before, options.dependencies, recordWithoutReturning);
                lifecycle.loadComplete = true;
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
            if (!lifecycle.stopped) {
                lifecycle.stopped = true;
                stopRuntimePolicyMonitoring(monitoring);
                for (const subscription of permissionDiagnosticsSubscriptions) {
                    subscription.unsubscribe();
                }
            }
            runErrors.push(...rawOutputPolicyErrors(options));

            const errors = Array.from(runErrors);
            runErrors.length = 0;

            return errors;
        }
    };
}
