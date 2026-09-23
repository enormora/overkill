import { AsyncLocalStorage } from 'node:async_hooks';
import { caseIdentityKey, type CaseId, type WorkId } from './identity.ts';
import type { RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

type HookKind = 'uncaughtException' | 'unhandledRejection';
type HookSubtype = 'uncaught-exception' | 'unhandled-rejection';
type ExecutionBoundary = 'in-process' | 'supervised-child' | 'worker-pool-host' | 'worker-pool-worker';
type ExecutionPhase = 'body' | 'collection' | 'run';
type FatalErrorHandler = (error: RunnerError) => unknown;
type FatalErrorHandlerDisposer = () => unknown;

type ActiveCaseContext = {
    readonly id: CaseId;
    readonly key: string;
    readonly scope: RunErrorScope;
    readonly workId: WorkId;
};

type SerializedHookReason = {
    readonly message: string;
    readonly name: string;
    readonly stack: string | null;
};

type HookRunnerErrorCause = {
    readonly boundary: ExecutionBoundary;
    readonly hook: HookKind;
    readonly origin: {
        readonly case: CaseId | null;
        readonly work: WorkId | null;
    };
    readonly phase: ExecutionPhase;
    readonly reason: SerializedHookReason;
};

type HookFailureInput = {
    readonly activeCase: ActiveCaseContext | null;
    readonly ambiguousScope: boolean;
    readonly hook: HookKind;
    readonly reason: unknown;
    readonly scope: RunErrorScope;
};

type StoredValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => unknown;
};

type ActiveScopes = {
    readonly add: (scope: RunErrorScope) => unknown;
    readonly all: () => readonly RunErrorScope[];
    readonly includes: (scope: RunErrorScope) => boolean;
    readonly remove: (scope: RunErrorScope) => unknown;
    readonly size: () => number;
};

type ProcessHookListeners = {
    readonly install: () => unknown;
    readonly removeWhenIdle: () => unknown;
};

type RunErrorScope = {
    readonly activeCaseStarted: (key: string) => unknown;
    readonly activeCaseStopped: (key: string) => unknown;
    readonly boundary: ExecutionBoundary;
    readonly fatalSignal: () => Promise<void>;
    readonly hasActiveCase: (key: string) => boolean;
    readonly hasFatalError: () => boolean;
    readonly onFatalError: (handler: FatalErrorHandler) => FatalErrorHandlerDisposer;
    readonly phase: () => ExecutionPhase;
    readonly recordError: (error: RunnerError) => unknown;
    readonly runPhase: <Value>(phase: ExecutionPhase, run: () => Promise<Value>) => Promise<Value>;
    readonly stop: () => unknown;
    readonly takeErrors: () => readonly RunnerError[];
};

export type ExecutionGlobalErrorObserver = {
    readonly fatalSignal: () => Promise<void>;
    readonly hasFatalError: () => boolean;
    readonly onFatalError: (handler: FatalErrorHandler) => FatalErrorHandlerDisposer;
    readonly runBoundary: <Value>(run: () => Promise<Value>) => Promise<Value>;
    readonly runCase: <Value>(testCase: TestPlanCase, run: () => Promise<Value>) => Promise<Value>;
    readonly runPhase: <Value>(phase: ExecutionPhase, run: () => Promise<Value>) => Promise<Value>;
    readonly stop: () => unknown;
    readonly takeErrors: () => readonly RunnerError[];
};

function createStoredValue<Value>(initialValue: Value): StoredValue<Value> {
    let currentValue = initialValue;

    return {
        read() {
            return currentValue;
        },
        write(value) {
            currentValue = value;
        }
    };
}

function createRunErrorScope(boundary: ExecutionBoundary): RunErrorScope {
    const activeCaseKeys = new Set<string>();
    const errors: RunnerError[] = [];
    const fatal = createStoredValue(false);
    const fatalHandlers = new Set<FatalErrorHandler>();
    const fatalSignal = createStoredValue<PromiseWithResolvers<undefined> | null>(null);
    const phase = createStoredValue<ExecutionPhase>('run');
    const stopped = createStoredValue(false);

    function notifyFatal(error: RunnerError): void {
        if (!fatal.read()) {
            fatal.write(true);
            fatalSignal.read()?.resolve(undefined);
        }

        for (const handler of fatalHandlers) {
            handler(error);
        }
    }

    return {
        activeCaseStarted(key) {
            activeCaseKeys.add(key);
        },
        activeCaseStopped(key) {
            activeCaseKeys.delete(key);
        },
        boundary,
        async fatalSignal() {
            if (fatal.read()) {
                return;
            }

            const currentFatalSignal = fatalSignal.read() ?? Promise.withResolvers<undefined>();

            fatalSignal.write(currentFatalSignal);
            await currentFatalSignal.promise;
        },
        hasActiveCase(key) {
            return activeCaseKeys.has(key);
        },
        hasFatalError() {
            return fatal.read();
        },
        onFatalError(handler) {
            fatalHandlers.add(handler);

            return function removeFatalErrorHandler() {
                fatalHandlers.delete(handler);
            };
        },
        phase() {
            return phase.read();
        },
        recordError(error) {
            if (stopped.read()) {
                return;
            }

            errors.push(error);
            notifyFatal(error);
        },
        async runPhase<Value>(nextPhase: ExecutionPhase, run: () => Promise<Value>): Promise<Value> {
            const previousPhase = phase.read();

            phase.write(nextPhase);

            try {
                return await run();
            } finally {
                phase.write(previousPhase);
            }
        },
        stop() {
            stopped.write(true);
            fatalHandlers.clear();
        },
        takeErrors() {
            const currentErrors = Array.from(errors);

            errors.length = 0;

            return currentErrors;
        }
    };
}

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

export function createDisabledExecutionGlobalErrorObserver(): ExecutionGlobalErrorObserver {
    const neverFatal: Promise<void> = Promise.race([]);

    return {
        async fatalSignal() {
            await neverFatal;
        },
        hasFatalError() {
            return false;
        },
        onFatalError() {
            return function removeDisabledFatalHandler() {
                return undefined;
            };
        },
        async runBoundary(run) {
            return await run();
        },
        async runCase(_testCase, run) {
            return await run();
        },
        async runPhase(_phase, run) {
            return await run();
        },
        stop() {
            return undefined;
        },
        takeErrors() {
            return [];
        }
    };
}

const runScopeStorage = new AsyncLocalStorage<RunErrorScope>();
const activeCaseStorage = new AsyncLocalStorage<ActiveCaseContext>();
const activeScopes = createActiveScopes();
const listenersInstalled = createStoredValue(false);

function serializedReason(reason: unknown): SerializedHookReason {
    if (reason instanceof Error) {
        return {
            message: reason.message,
            name: reason.name,
            stack: reason.stack ?? null
        };
    }

    return {
        message: String(reason),
        name: 'Error',
        stack: null
    };
}

function hookSubtype(hook: HookKind): HookSubtype {
    return hook === 'uncaughtException' ? 'uncaught-exception' : 'unhandled-rejection';
}

function hookMessage(hook: HookKind, reason: SerializedHookReason): string {
    const label = hook === 'uncaughtException' ? 'Uncaught exception' : 'Unhandled rejection';

    return `${label}: ${reason.message}`;
}

function hookCause(
    scope: RunErrorScope,
    hook: HookKind,
    reason: unknown,
    activeCase: ActiveCaseContext | null
): HookRunnerErrorCause {
    return {
        boundary: scope.boundary,
        hook,
        origin: {
            case: activeCase?.id ?? null,
            work: activeCase?.workId ?? null
        },
        phase: activeCase === null ? scope.phase() : 'body',
        reason: serializedReason(reason)
    };
}

function attributedError(
    scope: RunErrorScope,
    hook: HookKind,
    reason: unknown,
    activeCase: ActiveCaseContext
): RunnerError {
    const cause = hookCause(scope, hook, reason, activeCase);

    return {
        attributedTo: activeCase.id,
        attributedToWork: activeCase.workId,
        cause,
        message: hookMessage(hook, cause.reason),
        subtype: hookSubtype(hook)
    };
}

function runLevelHookError(scope: RunErrorScope, hook: HookKind, reason: unknown): RunnerError {
    const cause = hookCause(scope, hook, reason, null);

    return {
        attributedTo: null,
        attributedToWork: null,
        cause,
        message: hookMessage(hook, cause.reason),
        subtype: hookSubtype(hook)
    };
}

function attributionDriftError(
    scope: RunErrorScope,
    hook: HookKind,
    reason: unknown,
    activeCase: ActiveCaseContext | null
): RunnerError {
    const cause = hookCause(scope, hook, reason, activeCase);

    return {
        attributedTo: null,
        attributedToWork: null,
        cause,
        message: `Async failure could not be attributed safely: ${cause.reason.message}`,
        subtype: 'attribution-drift'
    };
}

function scopeIncludesCase(
    scope: RunErrorScope,
    activeCase: ActiveCaseContext | null
): activeCase is ActiveCaseContext {
    return activeCase !== null && activeCase.scope === scope;
}

function errorForScope(input: HookFailureInput): RunnerError {
    if (input.ambiguousScope) {
        return attributionDriftError(
            input.scope,
            input.hook,
            input.reason,
            scopeIncludesCase(input.scope, input.activeCase) ? input.activeCase : null
        );
    }

    if (!scopeIncludesCase(input.scope, input.activeCase)) {
        return runLevelHookError(input.scope, input.hook, input.reason);
    }

    if (input.scope.hasActiveCase(input.activeCase.key)) {
        return attributedError(input.scope, input.hook, input.reason, input.activeCase);
    }

    return attributionDriftError(input.scope, input.hook, input.reason, input.activeCase);
}

function currentTargetScopes(): readonly RunErrorScope[] {
    const currentScope = runScopeStorage.getStore();

    if (currentScope !== undefined && activeScopes.includes(currentScope)) {
        return [ currentScope ];
    }

    return activeScopes.all();
}

function receiveHookFailure(hook: HookKind, reason: unknown): void {
    const activeCase = activeCaseStorage.getStore() ?? null;
    const ambiguousScope = runScopeStorage.getStore() === undefined && activeScopes.size() > 1;

    for (const scope of currentTargetScopes()) {
        scope.recordError(errorForScope({ activeCase, ambiguousScope, hook, reason, scope }));
    }
}

function receiveUnhandledRejection(reason: unknown): void {
    receiveHookFailure('unhandledRejection', reason);
}

function receiveUncaughtException(error: Error): void {
    receiveHookFailure('uncaughtException', error);
}

function createProcessHookListeners(): ProcessHookListeners {
    return {
        install() {
            if (listenersInstalled.read()) {
                return;
            }

            process.prependListener('unhandledRejection', receiveUnhandledRejection);
            process.prependListener('uncaughtException', receiveUncaughtException);
            listenersInstalled.write(true);
        },
        removeWhenIdle() {
            if (listenersInstalled.read() && activeScopes.size() === 0) {
                process.removeListener('unhandledRejection', receiveUnhandledRejection);
                process.removeListener('uncaughtException', receiveUncaughtException);
                listenersInstalled.write(false);
            }
        }
    };
}

const processHookListeners = createProcessHookListeners();

export function createExecutionGlobalErrorObserver(boundary: ExecutionBoundary): ExecutionGlobalErrorObserver {
    const scope = createRunErrorScope(boundary);

    return {
        async fatalSignal() {
            await scope.fatalSignal();
        },
        hasFatalError() {
            return scope.hasFatalError();
        },
        onFatalError(handler) {
            return scope.onFatalError(handler);
        },
        async runBoundary(run) {
            processHookListeners.install();
            activeScopes.add(scope);

            try {
                return await runScopeStorage.run(scope, run);
            } finally {
                activeScopes.remove(scope);
                processHookListeners.removeWhenIdle();
            }
        },
        async runCase(testCase, run) {
            const activeCase = {
                id: testCase.id,
                key: caseIdentityKey(testCase.id),
                scope,
                workId: testCase.workId
            };

            scope.activeCaseStarted(activeCase.key);

            try {
                return await activeCaseStorage.run(activeCase, run);
            } finally {
                scope.activeCaseStopped(activeCase.key);
            }
        },
        async runPhase(phase, run) {
            return await scope.runPhase(phase, run);
        },
        stop() {
            scope.stop();
            activeScopes.remove(scope);
            processHookListeners.removeWhenIdle();
        },
        takeErrors() {
            return scope.takeErrors();
        }
    };
}
