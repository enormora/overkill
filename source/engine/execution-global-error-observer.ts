import {
    executionErrorOwnership,
    type HookKind,
    type ExecutionBoundary,
    type ExecutionPhase,
    type FatalErrorHandler,
    type FatalErrorHandlerDisposer,
    type ActiveCaseContext,
    type RunErrorScope
} from './execution-error-ownership.ts';
import {
    createExecutionObservation,
    observingInfrastructure
} from './execution-observation.ts';
import type { AttemptId, CaseId, WorkId } from './identity.ts';
import { permissionDeniedRunnerErrorFromThrown, type RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

type HookSubtype = 'uncaught-exception' | 'unhandled-rejection';

type SerializedHookReason = {
    readonly message: string;
    readonly name: string;
    readonly stack: string | null;
};

type HookRunnerErrorCause = {
    readonly boundary: ExecutionBoundary;
    readonly hook: HookKind;
    readonly origin: {
        readonly attempt: AttemptId | null;
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

export type ExecutionGlobalErrorObserver = {
    readonly fatalSignal: () => Promise<void>;
    readonly hasFatalError: () => boolean;
    readonly onFatalError: (handler: FatalErrorHandler) => FatalErrorHandlerDisposer;
    readonly runBoundary: <Value>(run: () => Promise<Value>) => Promise<Value>;
    readonly runCase: <Value>(testCase: TestPlanCase, attempt: AttemptId, run: () => Promise<Value>) => Promise<Value>;
    readonly runPhase: <Value>(phase: ExecutionPhase, run: () => Promise<Value>) => Promise<Value>;
    readonly stop: () => unknown;
    readonly takeErrors: () => readonly RunnerError[];
};

const { runScopeStorage, activeCaseStorage, activeScopes, processHookListeners } = executionErrorOwnership();

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
    const observation = createExecutionObservation();
    const activeCaseKeys = new Set<ActiveCaseContext>();
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
        observation,
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
            activeCaseKeys.clear();
            observation.stop();
        },
        takeErrors() {
            const currentErrors = Array.from(errors);

            errors.length = 0;

            return currentErrors;
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
        async runCase(_testCase, _attempt, run) {
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

function hookOrigin(activeCase: ActiveCaseContext | null): HookRunnerErrorCause['origin'] {
    return activeCase === null
        ? { attempt: null, case: null, work: null }
        : { attempt: activeCase.attempt, case: activeCase.id, work: activeCase.workId };
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
        origin: hookOrigin(activeCase),
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
        attributedToAttempt: activeCase.attempt,
        attributedTo: activeCase.id,
        attributedToWork: activeCase.workId,
        cause,
        diagnostics: [],
        message: hookMessage(hook, cause.reason),
        subtype: hookSubtype(hook)
    };
}

function runLevelHookError(scope: RunErrorScope, hook: HookKind, reason: unknown): RunnerError {
    const cause = hookCause(scope, hook, reason, null);

    return {
        attributedToAttempt: null,
        attributedTo: null,
        attributedToWork: null,
        cause,
        diagnostics: [],
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
        attributedToAttempt: null,
        attributedTo: null,
        attributedToWork: null,
        cause,
        diagnostics: [],
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

function activePermissionCase(input: HookFailureInput): ActiveCaseContext | null {
    if (!scopeIncludesCase(input.scope, input.activeCase)) {
        return null;
    }

    return input.scope.hasActiveCase(input.activeCase) ? input.activeCase : null;
}

function permissionErrorForScope(input: HookFailureInput): RunnerError | null {
    const activeCase = activePermissionCase(input);

    const attribution = activeCase === null
        ? { attributedTo: null, attributedToWork: null, phase: input.scope.phase() }
        : { attributedTo: activeCase.id, attributedToWork: activeCase.workId, phase: 'body' as const };
    const error = permissionDeniedRunnerErrorFromThrown(input.reason, {
        ...attribution,
        boundary: input.scope.boundary,
        diagnosticChannel: null,
        hook: input.hook
    });
    return error === null ? null : input.scope.observation.attribute(error);
}

function ownedHookError(input: HookFailureInput): RunnerError {
    if (!scopeIncludesCase(input.scope, input.activeCase)) {
        const error = runLevelHookError(input.scope, input.hook, input.reason);
        return input.scope.observation.attribute(error).subtype === 'attribution-drift'
            ? attributionDriftError(input.scope, input.hook, input.reason, input.activeCase)
            : error;
    }
    if (input.scope.hasActiveCase(input.activeCase)) {
        return attributedError(input.scope, input.hook, input.reason, input.activeCase);
    }
    return attributionDriftError(input.scope, input.hook, input.reason, input.activeCase);
}

function errorForScope(input: HookFailureInput): RunnerError {
    if (scopeIncludesCase(input.scope, input.activeCase) && !input.scope.hasActiveCase(input.activeCase)) {
        return attributionDriftError(input.scope, input.hook, input.reason, input.activeCase);
    }
    if (input.ambiguousScope) {
        return attributionDriftError(input.scope, input.hook, input.reason, null);
    }
    return permissionErrorForScope(input) ?? ownedHookError(input);
}

function currentTargetScopes(): readonly RunErrorScope[] {
    const currentScope = runScopeStorage.getStore();

    if (currentScope !== undefined && activeScopes.includes(currentScope)) {
        return [ currentScope ];
    }

    return activeScopes.all();
}

function receiveHookFailure(hook: HookKind, reason: unknown): void {
    const activeCase = observingInfrastructure() ? null : activeCaseStorage.getStore() ?? null;
    const ambiguousScope = runScopeStorage.getStore() === undefined && activeScopes.size() > 1;

    for (const scope of currentTargetScopes()) {
        scope.recordError(errorForScope({ activeCase, ambiguousScope, hook, reason, scope }));
    }
}

export function createExecutionGlobalErrorObserver(boundary: ExecutionBoundary): ExecutionGlobalErrorObserver {
    const scope = createRunErrorScope(boundary);
    scope.observation.register(function stopOwnedGlobalObserver() {
        scope.stop();
        activeScopes.remove(scope);
        processHookListeners.removeWhenIdle();
    });

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
            processHookListeners.install(receiveHookFailure);
            activeScopes.add(scope);

            try {
                return await scope.observation.run(async function observeRunOwnership() {
                    return await runScopeStorage.run(scope, run);
                });
            } finally {
                activeScopes.remove(scope);
                processHookListeners.removeWhenIdle();
            }
        },
        async runCase(testCase, attempt, run) {
            const activeCase = {
                attempt,
                id: testCase.id,
                scope,
                workId: testCase.workId
            };

            scope.activeCaseStarted(activeCase);

            try {
                return await scope.observation.runAttempt(testCase, attempt, async function observeAttemptOwnership() {
                    return await activeCaseStorage.run(activeCase, run);
                });
            } finally {
                scope.activeCaseStopped(activeCase);
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
