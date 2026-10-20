import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionObservation } from './execution-observation.ts';
import type { AttemptId, CaseId, WorkId } from './identity.ts';
import type { RunnerError } from './run-result.ts';

export type HookKind = 'uncaughtException' | 'unhandledRejection';
export type ExecutionBoundary = 'in-process' | 'supervised-child' | 'worker-pool-host' | 'worker-pool-worker';
export type ExecutionPhase = 'body' | 'collection' | 'run';
export type FatalErrorHandler = (error: RunnerError) => unknown;
export type FatalErrorHandlerDisposer = () => unknown;

export type ActiveCaseContext = {
    readonly attempt: AttemptId;
    readonly id: CaseId;
    readonly scope: RunErrorScope;
    readonly workId: WorkId;
};

type ActiveScopes = {
    readonly add: (scope: RunErrorScope) => unknown;
    readonly all: () => readonly RunErrorScope[];
    readonly includes: (scope: RunErrorScope) => boolean;
    readonly remove: (scope: RunErrorScope) => unknown;
    readonly size: () => number;
};

type ProcessHookListeners = {
    readonly install: (receive: (hook: HookKind, reason: unknown) => void) => unknown;
    readonly removeWhenIdle: () => unknown;
};

export type RunErrorScope = {
    readonly observation: ExecutionObservation;
    readonly activeCaseStarted: (key: ActiveCaseContext) => unknown;
    readonly activeCaseStopped: (key: ActiveCaseContext) => unknown;
    readonly boundary: ExecutionBoundary;
    readonly fatalSignal: () => Promise<void>;
    readonly hasActiveCase: (key: ActiveCaseContext) => boolean;
    readonly hasFatalError: () => boolean;
    readonly onFatalError: (handler: FatalErrorHandler) => FatalErrorHandlerDisposer;
    readonly phase: () => ExecutionPhase;
    readonly recordError: (error: RunnerError) => unknown;
    readonly runPhase: <Value>(phase: ExecutionPhase, run: () => Promise<Value>) => Promise<Value>;
    readonly stop: () => unknown;
    readonly takeErrors: () => readonly RunnerError[];
};

function createActiveScopes(): ActiveScopes {
    const scopes: RunErrorScope[] = [];

    return {
        add(scope) {
            scopes.push(scope);
        },
        all() {
            return Array.from(scopes);
        },
        includes(scope) {
            return scopes.includes(scope);
        },
        remove(scope) {
            const index = scopes.lastIndexOf(scope);

            if (index !== -1) {
                scopes.splice(index, 1);
            }
        },
        size() {
            return scopes.length;
        }
    };
}

type ExecutionErrorOwnership = {
    readonly runScopeStorage: AsyncLocalStorage<RunErrorScope>;
    readonly activeCaseStorage: AsyncLocalStorage<ActiveCaseContext>;
    readonly activeScopes: ActiveScopes;
    readonly processHookListeners: ProcessHookListeners;
};

const ownershipKey = Symbol.for('@overkill-dev/engine/executionErrorOwnership');

function hasMethods(value: unknown, names: readonly string[]): boolean {
    return typeof value === 'object' && value !== null && names.every(function callable(name) {
        return typeof Reflect.get(value, name) === 'function';
    });
}

function isErrorOwnership(value: unknown): value is ExecutionErrorOwnership {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return Reflect.get(value, 'runScopeStorage') instanceof AsyncLocalStorage &&
        Reflect.get(value, 'activeCaseStorage') instanceof AsyncLocalStorage &&
        hasMethods(Reflect.get(value, 'activeScopes'), [ 'add', 'all', 'includes', 'remove', 'size' ]) &&
        hasMethods(Reflect.get(value, 'processHookListeners'), [ 'install', 'removeWhenIdle' ]);
}

function createProcessHookListeners(activeScopes: ActiveScopes): ProcessHookListeners {
    let stop: (() => void) | null = null;
    return {
        install(receive) {
            if (stop !== null) {
                return;
            }
            function receiveUnhandledRejection(reason: unknown): void {
                receive('unhandledRejection', reason);
            }
            function receiveUncaughtException(error: Error): void {
                receive('uncaughtException', error);
            }
            process.prependListener('unhandledRejection', receiveUnhandledRejection);
            process.prependListener('uncaughtException', receiveUncaughtException);
            stop = function removeProcessListeners() {
                process.removeListener('unhandledRejection', receiveUnhandledRejection);
                process.removeListener('uncaughtException', receiveUncaughtException);
            };
        },
        removeWhenIdle() {
            if (activeScopes.size() === 0) {
                stop?.();
                stop = null;
            }
        }
    };
}

export function executionErrorOwnership(): ExecutionErrorOwnership {
    const existing: unknown = Reflect.get(globalThis, ownershipKey);
    if (isErrorOwnership(existing)) {
        return existing;
    }
    const activeScopes = createActiveScopes();
    const created = {
        runScopeStorage: new AsyncLocalStorage<RunErrorScope>(),
        activeCaseStorage: new AsyncLocalStorage<ActiveCaseContext>(),
        activeScopes,
        processHookListeners: createProcessHookListeners(activeScopes)
    };
    Reflect.set(globalThis, ownershipKey, created);
    return created;
}
