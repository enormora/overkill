import asyncHooks, { AsyncLocalStorage } from 'node:async_hooks';
import diagnosticsChannel from 'node:diagnostics_channel';
import type { Except } from 'type-fest';
import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { TestRuntimePolicy } from '../engine/case-execution.ts';

export type RuntimeCapabilityPolicy = TestRuntimePolicy;
export type RuntimeCapabilityPolicyEnvironment = Readonly<Record<string, string | undefined>>;

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

type CapabilityPolicyOptions = {
    readonly dependencies: RuntimeCapabilityPolicyDependencies;
    readonly observedStderr: boolean;
    readonly observedStdout: boolean;
};

type ActiveCase = {
    readonly id: CaseId;
    readonly key: string;
};

type EnvironmentSnapshot = {
    readonly entries: readonly (readonly [string, string])[];
    readonly object: RuntimeCapabilityPolicyEnvironment;
};

type StorageSnapshot = {
    readonly entries: readonly (readonly [string, string])[];
    readonly object: WebStorageLike | null;
};

export type WebStorageLike = {
    readonly length: number;
    readonly getItem: (key: string) => string | null;
    readonly key: (index: number) => string | null;
};

export type RuntimeCapabilityPolicyDependencies = {
    readonly readEnvironment: () => RuntimeCapabilityPolicyEnvironment;
    readonly readStorage: (name: 'localStorage' | 'sessionStorage') => WebStorageLike | null;
};

type RuntimePolicyViolation = {
    readonly capability: RuntimePolicyCapability;
    readonly caseId: CaseId | null;
    readonly message: string;
    readonly phase: RuntimePolicyPhase;
    readonly strictness: RuntimePolicyStrictness;
};

type RuntimePolicyReport = Except<RuntimePolicyViolation, 'caseId' | 'phase'>;

type Subscription = {
    readonly unsubscribe: () => void;
};

type AsyncResourceHook = {
    readonly disable: () => void;
    readonly enable: () => void;
};

type RuntimeSnapshots = {
    readonly environment: EnvironmentSnapshot;
    readonly localStorage: StorageSnapshot;
    readonly sessionStorage: StorageSnapshot;
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
    'node:permission-model:child': runtimePolicyCapabilities.childProcess,
    'node:permission-model:ffi': runtimePolicyCapabilities.worker,
    'node:permission-model:fs': runtimePolicyCapabilities.fileRead,
    'node:permission-model:inspector': runtimePolicyCapabilities.inspector,
    'node:permission-model:net': runtimePolicyCapabilities.network,
    'node:permission-model:openssl-store': runtimePolicyCapabilities.openSslStore,
    'node:permission-model:wasi': runtimePolicyCapabilities.wasi,
    'node:permission-model:worker': runtimePolicyCapabilities.worker,
    [processExecuteChannel]: runtimePolicyCapabilities.processExecute,
    'tracing:module.import:asyncStart': runtimePolicyCapabilities.dynamicModuleLoad,
    'tracing:module.import:start': runtimePolicyCapabilities.dynamicModuleLoad,
    'tracing:module.require:start': runtimePolicyCapabilities.dynamicModuleLoad,
    'udp.socket': runtimePolicyCapabilities.network,
    worker_threads: runtimePolicyCapabilities.worker
};

function sortedEnvironmentEntries(environment: RuntimeCapabilityPolicyEnvironment): readonly [string, string][] {
    return Object
        .entries(environment)
        .filter(function hasValue(entry): entry is [string, string] {
            return entry[1] !== undefined;
        })
        .toSorted(function compareEnvironmentEntries(first, second) {
            return first[0].localeCompare(second[0]);
        });
}

function environmentSnapshot(dependencies: RuntimeCapabilityPolicyDependencies): EnvironmentSnapshot {
    const environment = dependencies.readEnvironment();

    return {
        entries: sortedEnvironmentEntries(environment),
        object: environment
    };
}

export function isRuntimeCapabilityPolicyEnvironment(
    value: unknown
): value is RuntimeCapabilityPolicyEnvironment {
    return typeof value === 'object' &&
        value !== null &&
        Object.values(value).every(function validEnvironmentValue(entry) {
            return typeof entry === 'string' || entry === undefined;
        });
}

export function isWebStorageLike(value: unknown): value is WebStorageLike {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const length: unknown = Reflect.get(value, 'length');
    const getItem: unknown = Reflect.get(value, 'getItem');
    const key: unknown = Reflect.get(value, 'key');

    return typeof length === 'number' &&
        typeof getItem === 'function' &&
        typeof key === 'function';
}

function storageSnapshot(
    dependencies: RuntimeCapabilityPolicyDependencies,
    name: 'localStorage' | 'sessionStorage'
): StorageSnapshot {
    const storage = dependencies.readStorage(name);

    if (!isWebStorageLike(storage)) {
        return {
            entries: [],
            object: null
        };
    }

    const entries: readonly [string, string][] = Array
        .from({ length: storage.length }, function toStorageEntry(
            _unusedValue,
            index
        ): [string, string] | null {
            const key = storage.key(index);

            return key === null ? null : [ key, storage.getItem(key) ?? '' ];
        })
        .filter(function isEntry(entry): entry is [string, string] {
            return entry !== null;
        })
        .toSorted(function compareStorageEntries(first, second) {
            return first[0].localeCompare(second[0]);
        });

    return {
        entries,
        object: storage
    };
}

function entriesChanged(
    before: readonly (readonly [string, string])[],
    after: readonly (readonly [string, string])[]
): boolean {
    if (before.length !== after.length) {
        return true;
    }

    return before.some(function changed(entry, index) {
        const afterEntry = after[index];

        return afterEntry?.[0] !== entry[0] || afterEntry[1] !== entry[1];
    });
}

function permissionCapability(message: unknown, fallback: RuntimePolicyCapability): RuntimePolicyCapability {
    if (typeof message !== 'object' || message === null) {
        return fallback;
    }

    const permission = String(Reflect.get(message, 'permission'));

    if (permission === 'FileSystemWrite') {
        return runtimePolicyCapabilities.fileWrite;
    }

    if (permission === 'FileSystemRead') {
        return runtimePolicyCapabilities.fileRead;
    }

    return fallback;
}

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
        attributedTo: violation.caseId,
        cause: violation,
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
        const listener = function recordDiagnostic(message: unknown): void {
            const resolvedCapability = name.startsWith('node:permission-model:')
                ? permissionCapability(message, capability)
                : capability;

            recordViolation({
                capability: resolvedCapability,
                message: `Runtime policy violation: ${resolvedCapability}.`,
                strictness: name.startsWith('node:permission-model:') ? 'blocked' : 'observed'
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

function environmentChanged(before: RuntimeSnapshots, after: EnvironmentSnapshot): boolean {
    return before.environment.object !== after.object ||
        entriesChanged(before.environment.entries, after.entries);
}

function storageChanged(before: StorageSnapshot, after: StorageSnapshot): boolean {
    return before.object !== after.object || entriesChanged(before.entries, after.entries);
}

function takeSnapshots(dependencies: RuntimeCapabilityPolicyDependencies): RuntimeSnapshots {
    return {
        environment: environmentSnapshot(dependencies),
        localStorage: storageSnapshot(dependencies, 'localStorage'),
        sessionStorage: storageSnapshot(dependencies, 'sessionStorage')
    };
}

function recordSnapshotChanges(
    before: RuntimeSnapshots,
    dependencies: RuntimeCapabilityPolicyDependencies,
    record: (violation: RuntimePolicyReport) => void
): void {
    const afterEnvironment = environmentSnapshot(dependencies);
    const afterSessionStorage = storageSnapshot(dependencies, 'sessionStorage');
    const afterLocalStorage = storageSnapshot(dependencies, 'localStorage');

    if (environmentChanged(before, afterEnvironment)) {
        record({
            capability: runtimePolicyCapabilities.processEnvironment,
            message: 'Runtime policy violation: process.env changed.',
            strictness: 'observed'
        });
    }

    if (storageChanged(before.sessionStorage, afterSessionStorage)) {
        record({
            capability: runtimePolicyCapabilities.fileWrite,
            message: 'Runtime policy violation: sessionStorage changed.',
            strictness: 'observed'
        });
    }

    if (storageChanged(before.localStorage, afterLocalStorage)) {
        record({
            capability: runtimePolicyCapabilities.fileWrite,
            message: 'Runtime policy violation: localStorage changed.',
            strictness: 'observed'
        });
    }
}

export function createRuntimeCapabilityPolicy(options: CapabilityPolicyOptions): TestRuntimePolicy {
    const activeCaseStorage = new AsyncLocalStorage<ActiveCase>();
    const caseErrors = new Map<string, RunnerError[]>();
    const runErrors: RunnerError[] = [];
    let loadComplete = false;

    function record(violation: RuntimePolicyReport): void {
        const activeCase = activeCaseStorage.getStore();

        if (ignoredViolation(violation, activeCase, loadComplete)) {
            return;
        }

        const completedViolation: RuntimePolicyViolation = {
            ...violation,
            caseId: activeCase?.id ?? null,
            phase: violationPhase(activeCase, loadComplete)
        };
        const error = runtimePolicyError(completedViolation);

        if (activeCase === undefined) {
            runErrors.push(error);
            return;
        }

        caseErrors.set(activeCase.key, [ ...caseErrors.get(activeCase.key) ?? [], error ]);
    }

    function tryRecord(violation: RuntimePolicyReport): void {
        try {
            record(violation);
        } catch {
        }
    }

    const subscriptions = createDiagnosticsSubscriptions(tryRecord);
    const hook = createAsyncResourceHook(activeCaseStorage, tryRecord);
    hook.enable();

    return {
        async runCase(testCase, run) {
            loadComplete = true;
            const activeCase = {
                id: testCase.id,
                key: caseIdentityKey(testCase.id)
            };
            const before = takeSnapshots(options.dependencies);

            try {
                return await activeCaseStorage.run(activeCase, run);
            } finally {
                activeCaseStorage.run(activeCase, function recordCaseSnapshotChanges() {
                    recordSnapshotChanges(before, options.dependencies, record);
                });
            }
        },
        async runLoad(run) {
            const before = takeSnapshots(options.dependencies);

            try {
                return await run();
            } finally {
                recordSnapshotChanges(before, options.dependencies, record);
                loadComplete = true;
            }
        },
        takeCaseErrors(testCase) {
            const key = caseIdentityKey(testCase.id);
            const errors = caseErrors.get(key) ?? [];
            caseErrors.delete(key);

            return errors;
        },
        takeRunErrors() {
            hook.disable();

            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }

            if (options.observedStdout) {
                runErrors.push(runtimePolicyError({
                    capability: 'raw-stdout',
                    caseId: null,
                    message: 'Runtime policy violation: unexpected stdout output.',
                    phase: 'out-of-test',
                    strictness: 'observed'
                }));
            }

            if (options.observedStderr) {
                runErrors.push(runtimePolicyError({
                    capability: 'raw-stderr',
                    caseId: null,
                    message: 'Runtime policy violation: unexpected stderr output.',
                    phase: 'out-of-test',
                    strictness: 'observed'
                }));
            }

            const errors = Array.from(runErrors);
            runErrors.length = 0;

            return errors;
        }
    };
}
