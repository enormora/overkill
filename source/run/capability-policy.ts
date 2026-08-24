import asyncHooks, { AsyncLocalStorage } from 'node:async_hooks';
import diagnosticsChannel from 'node:diagnostics_channel';
import type { CaseId } from '../engine/identity.ts';
import { caseIdentityKey } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { TestRuntimePolicy } from '../engine/case-execution.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';

type RuntimePolicyCapability =
    'child-process' |
    'console' |
    'crypto-random' |
    'dynamic-module-load' |
    'fs-read' |
    'fs-write' |
    'inspector' |
    'net' |
    'openssl-store' |
    'process-env' |
    'process-execve' |
    'raw-stderr' |
    'raw-stdout' |
    'timer' |
    'wasi' |
    'web-locks' |
    'worker';

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
    readonly entries: readonly [string, string][];
    readonly object: NodeJS.ProcessEnv;
};

type StorageSnapshot = {
    readonly entries: readonly [string, string][];
    readonly object: WebStorageLike | null;
};

type WebStorageLike = {
    readonly length: number;
    readonly getItem: (key: string) => string | null;
    readonly key: (index: number) => string | null;
};

export type RuntimeCapabilityPolicyDependencies = {
    readonly readEnvironment: () => NodeJS.ProcessEnv;
    readonly readStorage: (name: 'localStorage' | 'sessionStorage') => WebStorageLike | null;
};

type RuntimePolicyViolation = {
    readonly capability: RuntimePolicyCapability;
    readonly caseId: CaseId | null;
    readonly message: string;
    readonly phase: RuntimePolicyPhase;
    readonly strictness: RuntimePolicyStrictness;
};

type Subscription = {
    readonly unsubscribe: () => void;
};

type RuntimeSnapshots = {
    readonly environment: EnvironmentSnapshot;
    readonly localStorage: StorageSnapshot;
    readonly sessionStorage: StorageSnapshot;
};

const asyncFileResourceTypes = new Set([
    'FILEHANDLE',
    'FILEHANDLECLOSEREQ',
    'FSREQCALLBACK',
    'FSREQPROMISE'
]);

const diagnosticsCapabilities = Object.freeze({
    'console.debug': 'console',
    'console.error': 'console',
    'console.info': 'console',
    'console.log': 'console',
    'console.warn': 'console',
    'http.client.request.created': 'net',
    'http.client.request.error': 'net',
    'http.client.request.start': 'net',
    'locks.request.end': 'web-locks',
    'locks.request.grant': 'web-locks',
    'locks.request.miss': 'web-locks',
    'locks.request.start': 'web-locks',
    'net.client.socket': 'net',
    'node:permission-model:child': 'child-process',
    'node:permission-model:ffi': 'worker',
    'node:permission-model:fs': 'fs-read',
    'node:permission-model:inspector': 'inspector',
    'node:permission-model:net': 'net',
    'node:permission-model:openssl-store': 'openssl-store',
    'node:permission-model:wasi': 'wasi',
    'node:permission-model:worker': 'worker',
    'process.execve': 'process-execve',
    'tracing:module.import:asyncStart': 'dynamic-module-load',
    'tracing:module.import:start': 'dynamic-module-load',
    'tracing:module.require:start': 'dynamic-module-load',
    'udp.socket': 'net',
    'worker_threads': 'worker'
} satisfies Readonly<Record<string, RuntimePolicyCapability>>);

function sortedEnvironmentEntries(environment: NodeJS.ProcessEnv): readonly [string, string][] {
    return Object.entries(environment)
        .filter(function hasValue(entry): entry is [string, string] {
            return entry[1] !== undefined;
        })
        .sort(function compareEnvironmentEntries(first, second) {
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

    const entries = Array.from({ length: storage.length }, function toStorageEntry(_, index) {
        const key = storage.key(index);

        return key === null ? null : [ key, storage.getItem(key) ?? '' ] as const;
    }).filter(function isEntry(entry): entry is readonly [string, string] {
        return entry !== null;
    }).sort(function compareStorageEntries(first, second) {
        return first[0].localeCompare(second[0]);
    });

    return {
        entries,
        object: storage
    };
}

function isWebStorageLike(value: unknown): value is WebStorageLike {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Readonly<Record<string, unknown>>;

    return typeof candidate.length === 'number' &&
        typeof candidate.getItem === 'function' &&
        typeof candidate.key === 'function';
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

        return afterEntry === undefined || entry[0] !== afterEntry[0] || entry[1] !== afterEntry[1];
    });
}

function permissionCapability(message: unknown, fallback: RuntimePolicyCapability): RuntimePolicyCapability {
    if (typeof message !== 'object' || message === null || !Object.hasOwn(message, 'permission')) {
        return fallback;
    }

    const permission = String((message as { readonly permission: unknown; }).permission);

    if (permission === 'FileSystemWrite') {
        return 'fs-write';
    }

    if (permission === 'FileSystemRead') {
        return 'fs-read';
    }

    return fallback;
}

function runtimePolicyError(violation: RuntimePolicyViolation): RunnerError {
    return {
        attributedTo: violation.caseId,
        cause: violation,
        message: violation.message,
        subtype: 'runtime-policy'
    };
}

export function createRuntimeCapabilityPolicy(options: CapabilityPolicyOptions): TestRuntimePolicy {
    const activeCaseStorage = new AsyncLocalStorage<ActiveCase>();
    const caseErrors = new Map<string, RunnerError[]>();
    const runErrors: RunnerError[] = [];
    let loadComplete = false;

    function ignoredLoadCapability(capability: RuntimePolicyCapability): boolean {
        return capability === 'dynamic-module-load' || capability === 'fs-read';
    }

    function record(violation: Omit<RuntimePolicyViolation, 'caseId' | 'phase'>): void {
        const activeCase = activeCaseStorage.getStore();

        if (activeCase === undefined && violation.capability === 'fs-read') {
            return;
        }

        if (activeCase === undefined && !loadComplete && ignoredLoadCapability(violation.capability)) {
            return;
        }

        const completedViolation: RuntimePolicyViolation = {
            ...violation,
            caseId: activeCase?.id ?? null,
            phase: activeCase === undefined ? loadComplete ? 'out-of-test' : 'load' : 'body'
        };
        const error = runtimePolicyError(completedViolation);

        if (activeCase === undefined) {
            runErrors.push(error);
            return;
        }

        caseErrors.set(activeCase.key, [ ...(caseErrors.get(activeCase.key) ?? []), error ]);
    }

    function tryRecord(violation: Omit<RuntimePolicyViolation, 'caseId' | 'phase'>): void {
        try {
            record(violation);
        } catch {
            return undefined;
        }
    }

    const subscriptions: Subscription[] = Object.entries(diagnosticsCapabilities).map(function subscribeToChannel(
        [ name, capability ]
    ) {
        const channel = diagnosticsChannel.channel(name);
        const listener = function recordDiagnostic(message: unknown) {
            const resolvedCapability = name.startsWith('node:permission-model:')
                ? permissionCapability(message, capability)
                : capability;

            tryRecord({
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

    const hook = asyncHooks.createHook({
        init(_asyncId, type) {
            if (type === 'Timeout') {
                if (activeCaseStorage.getStore() !== undefined) {
                    tryRecord({
                        capability: 'timer',
                        message: 'Runtime policy violation: setTimeout/setInterval created a timer.',
                        strictness: 'observed'
                    });
                }
            } else if (asyncFileResourceTypes.has(type)) {
                tryRecord({
                    capability: 'fs-read',
                    message: `Runtime policy violation: asynchronous file resource ${type}.`,
                    strictness: 'observed'
                });
            } else if (type === 'RANDOMBYTESREQUEST' || type === 'RANDOMPRIMEREQUEST') {
                tryRecord({
                    capability: 'crypto-random',
                    message: `Runtime policy violation: asynchronous random resource ${type}.`,
                    strictness: 'observed'
                });
            } else if (type === 'WORKER') {
                tryRecord({
                    capability: 'worker',
                    message: 'Runtime policy violation: worker resource created.',
                    strictness: 'observed'
                });
            }
        }
    });
    hook.enable();

    function takeSnapshots(): RuntimeSnapshots {
        return {
            environment: environmentSnapshot(options.dependencies),
            localStorage: storageSnapshot(options.dependencies, 'localStorage'),
            sessionStorage: storageSnapshot(options.dependencies, 'sessionStorage')
        };
    }

    function recordSnapshotChanges(before: RuntimeSnapshots): void {
        const afterEnvironment = environmentSnapshot(options.dependencies);
        const afterSessionStorage = storageSnapshot(options.dependencies, 'sessionStorage');
        const afterLocalStorage = storageSnapshot(options.dependencies, 'localStorage');

        if (
            before.environment.object !== afterEnvironment.object ||
            entriesChanged(before.environment.entries, afterEnvironment.entries)
        ) {
            record({
                capability: 'process-env',
                message: 'Runtime policy violation: process.env changed.',
                strictness: 'observed'
            });
        }

        if (
            before.sessionStorage.object !== afterSessionStorage.object ||
            entriesChanged(before.sessionStorage.entries, afterSessionStorage.entries)
        ) {
            record({
                capability: 'fs-write',
                message: 'Runtime policy violation: sessionStorage changed.',
                strictness: 'observed'
            });
        }

        if (
            before.localStorage.object !== afterLocalStorage.object ||
            entriesChanged(before.localStorage.entries, afterLocalStorage.entries)
        ) {
            record({
                capability: 'fs-write',
                message: 'Runtime policy violation: localStorage changed.',
                strictness: 'observed'
            });
        }
    }

    return {
        async runCase(testCase, run) {
            loadComplete = true;
            const activeCase = {
                id: testCase.id,
                key: caseIdentityKey(testCase.id)
            };
            const before = takeSnapshots();

            try {
                return await activeCaseStorage.run(activeCase, run);
            } finally {
                activeCaseStorage.run(activeCase, function recordCaseSnapshotChanges() {
                    recordSnapshotChanges(before);
                });
            }
        },
        async runLoad(run) {
            const before = takeSnapshots();

            try {
                return await run();
            } finally {
                recordSnapshotChanges(before);
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

            return runErrors.splice(0);
        }
    };
}
