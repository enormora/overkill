import asyncHooks from 'node:async_hooks';
import diagnosticsChannel from 'node:diagnostics_channel';
import { workIdentityKey, type CaseId, type WorkId } from '../engine/identity.ts';
import {
    createExecutionObservation,
    withExecutionObservation,
    type ExecutionObservation
} from '../engine/execution-observation.ts';
import { recordReporterConsoleDiagnostic } from '../engine/reporter-output-scope.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { TestRuntimePolicy } from '../engine/case-execution-context.ts';
import {
    createPermissionDenialRuntimePolicy as createPermissionDenialRuntimePolicyCore,
    createPermissionDiagnosticsSubscriptions
} from './permission-denial-runtime-policy.ts';
import {
    createSnapshotCheckpoints,
    type RuntimeCapabilityPolicyDependencies
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

const asyncFileResourceTypes = new Set([
    'FILEHANDLE',
    'FILEHANDLECLOSEREQ',
    `${[ 'FS', 'REQ' ].join('')}CALLBACK`,
    `${[ 'FS', 'REQ' ].join('')}PROMISE`
]);
const processExecuteChannel = [ 'process.', 'exec', 've' ].join('');
const randomResourceReport: RuntimePolicyReport = {
    capability: runtimePolicyCapabilities.cryptoRandom,
    message: 'Runtime policy violation: asynchronous random operation.',
    strictness: 'observed'
};
const staticAsyncResourceReports: Readonly<Record<string, RuntimePolicyReport>> = {
    RANDOMBYTESREQUEST: randomResourceReport,
    RANDOMPRIMEREQUEST: randomResourceReport,
    WORKER: {
        capability: runtimePolicyCapabilities.worker,
        message: 'Runtime policy violation: Node worker created.',
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
            message: `Runtime policy violation: asynchronous file operation ${type}.`,
            strictness: 'observed'
        };
    }

    return staticAsyncResourceReports[type] ?? null;
}

function createAsyncResourceHook(
    observation: ExecutionObservation,
    recordViolation: (violation: RuntimePolicyReport) => void
): AsyncResourceHook {
    const createHookKey = 'createHook';
    const createHook = asyncHooks[createHookKey];

    return createHook({
        init(_asyncId, type) {
            const report = asyncResourceReport(type, observation.hasActiveAttempt());

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

function observedPolicyError(
    violation: RuntimePolicyReport,
    observation: ExecutionObservation,
    phase: RuntimePolicyPhase
): RunnerError {
    const error = observation.attribute(runtimePolicyError({ ...violation, caseId: null, workId: null, phase }));
    if (error.subtype !== 'runtime-policy') {
        return error;
    }
    return {
        ...error,
        cause: { ...violation, caseId: error.attributedTo, workId: error.attributedToWork ?? null, phase }
    };
}

function ignoredLoadCapability(capability: RuntimePolicyCapability): boolean {
    return capability === runtimePolicyCapabilities.dynamicModuleLoad ||
        capability === runtimePolicyCapabilities.fileRead;
}

function ignoredViolation(
    violation: RuntimePolicyReport,
    hasActiveCase: boolean,
    loadComplete: boolean
): boolean {
    return !hasActiveCase &&
        (
            violation.capability === runtimePolicyCapabilities.fileRead ||
            !loadComplete && ignoredLoadCapability(violation.capability)
        );
}

function violationPhase(hasActiveCase: boolean, loadComplete: boolean): RuntimePolicyPhase {
    if (hasActiveCase) {
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

function observeRuntimeProcessEvents(
    dependencies: RuntimeCapabilityPolicyDependencies,
    record: (violation: RuntimePolicyReport) => RunnerError,
    observation: ExecutionObservation
): void {
    const stopObservingExit = dependencies.observeProcessExit(
        function recordProcessExecutionViolation(message) {
            return record({
                capability: runtimePolicyCapabilities.processExecute,
                message,
                strictness: 'observed'
            });
        }
    );
    observation.register(stopObservingExit);
    const stopObservingIpc = dependencies.observeIpcListeners(function recordIpcViolation(message) {
        record({
            capability: runtimePolicyCapabilities.childProcess,
            message,
            strictness: 'observed'
        });
    });

    observation.register(stopObservingIpc);
}

function startRuntimePolicyMonitoring(
    observation: ExecutionObservation,
    record: (violation: RuntimePolicyReport) => RunnerError,
    dependencies: RuntimeCapabilityPolicyDependencies
): void {
    function recordObservedViolation(violation: RuntimePolicyReport): void {
        try {
            record(violation);
        } catch {
        }
    }
    const subscriptions = createDiagnosticsSubscriptions(recordObservedViolation);
    for (const subscription of subscriptions) {
        observation.register(subscription.unsubscribe);
    }
    const hook = createAsyncResourceHook(observation, recordObservedViolation);
    observation.register(function stopAsyncResources() {
        hook.disable();
    });
    observeRuntimeProcessEvents(dependencies, record, observation);
    hook.enable();
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

function permissionDiagnosticsPhase(loadComplete: boolean): RuntimePolicyPhase {
    return loadComplete ? 'out-of-test' : 'load';
}

export const createPermissionDenialRuntimePolicy: () => TestRuntimePolicy = createPermissionDenialRuntimePolicyCore;

export async function withRuntimePolicy<Value>(
    create: () => TestRuntimePolicy,
    execute: (policy: TestRuntimePolicy) => Promise<Value>
): Promise<Value> {
    return await withExecutionObservation(async function observeRuntimePolicy() {
        const policy = create();
        try {
            return await execute(policy);
        } finally {
            policy.takeRunErrors();
        }
    });
}

export function createRuntimeCapabilityPolicy(options: CapabilityPolicyOptions): RuntimeCapabilityPolicy {
    const observation = createExecutionObservation();
    const caseErrors = new Map<string, RunnerError[]>();
    const runErrors: RunnerError[] = [];
    const lifecycle = { loadComplete: false, stopped: false };

    function recordPermissionError(error: RunnerError): void {
        if (
            error.attributedToWork === null || error.attributedToWork === undefined ||
            error.attributedToAttempt === null
        ) {
            runErrors.push(error);
            return;
        }
        const key = `${workIdentityKey(error.attributedToWork)}:${error.attributedToAttempt.index}`;
        caseErrors.set(key, [ ...caseErrors.get(key) ?? [], error ]);
    }

    function record(violation: RuntimePolicyReport): RunnerError {
        const phase = violationPhase(observation.hasActiveAttempt(), lifecycle.loadComplete);
        const error = observedPolicyError(violation, observation, phase);
        if (
            observation.accepts() &&
            !ignoredViolation(violation, observation.hasActiveAttempt(), lifecycle.loadComplete)
        ) {
            recordPermissionError(error);
        }
        return error;
    }

    const snapshots = createSnapshotCheckpoints(options.dependencies, function snapshotChanged(change) {
        const name = change === 'environment' ? 'process.env' : change;
        record({
            capability: change === 'environment'
                ? runtimePolicyCapabilities.processEnvironment
                : runtimePolicyCapabilities.fileWrite,
            message: `Runtime policy violation: ${name} changed.`,
            strictness: 'observed'
        });
    });

    startRuntimePolicyMonitoring(observation, record, options.dependencies);
    createPermissionDiagnosticsSubscriptions(
        observation,
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
            if (!observation.open()) {
                return;
            }
            const error = observedPolicyError(
                { capability, message, strictness },
                observation,
                violationPhase(observation.hasActiveAttempt(), lifecycle.loadComplete)
            );
            recordPermissionError(error);
        },
        async prepareAttempt() {
            return undefined;
        },
        async completeCase() {
            return undefined;
        },
        async runAttempt(testCase, attempt, run) {
            lifecycle.loadComplete = true;
            return await observation.runAttempt(testCase, attempt, async function observeCaseSnapshots() {
                return await snapshots.observe(`${workIdentityKey(testCase.workId)}:${attempt.index}`, run);
            });
        },
        async runLoad(run) {
            return await observation.run(async function observeLoadSnapshots() {
                try {
                    return await snapshots.observe('load', run);
                } finally {
                    lifecycle.loadComplete = true;
                }
            });
        },
        takeAttemptErrors(testCase, attempt) {
            const key = `${workIdentityKey(testCase.workId)}:${attempt.index}`;
            snapshots.check(key);
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
                observation.stop();
                runErrors.push(...rawOutputPolicyErrors(options));
            }

            const errors = Array.from(runErrors);
            runErrors.length = 0;

            return errors;
        }
    };
}
