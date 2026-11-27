import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import { runAssertionBody, scopeWithAssertionSettlement } from './assertion-lifetime.ts';
import { currentTestDebugScope } from './test-debug-recording.ts';
import type { AssertionRecorder } from './assertion-recorder.ts';
import {
    createAsyncControlState,
    drainMicrotasks,
    registerCleanup,
    runCleanups,
    settleAsyncWork,
    startInFlight,
    validateInFlightTasks,
    yieldToNextTurn
} from './async-control.ts';
import { createRecordingAssertFacade } from './assertion-facade.ts';
import { createRecordingRequireFacade } from './require-assertion-facade.ts';
import type { TestContractFailure } from './run-result.ts';
import type { TestBody, TestScope, ThrowingTestBody, ThrowingTestScope } from './test-scope.ts';
import { createTestRandom, deriveCaseSeed, type CaseRandomContext } from './case-random.ts';

type FinishedScopeLifecycle = {
    readonly cleanupErrors: readonly unknown[];
    readonly lifecycleFailures: readonly TestContractFailure[];
};

export type TestScopeLifecycle = {
    readonly createScope: (signal: AbortSignal) => TestScope;
    readonly finish: (controller: AbortController) => Promise<FinishedScopeLifecycle>;
    readonly runBody: (
        signal: AbortSignal,
        body: (scope: TestScope) => AssertionResult | Promise<AssertionResult>
    ) => Promise<AssertionResult>;
};

export function createTestScopeLifecycle(recorder: AssertionRecorder, context: CaseRandomContext): TestScopeLifecycle {
    const seed = deriveCaseSeed(context.seed, context.work);
    const state = createAsyncControlState();
    let finishing: Promise<FinishedScopeLifecycle> | null = null;
    async function finish(controller: AbortController): Promise<FinishedScopeLifecycle> {
        controller.abort();
        const cleanupErrors = await runCleanups(state);
        await drainMicrotasks();
        return { cleanupErrors, lifecycleFailures: validateInFlightTasks(state) };
    }
    function closeRecording(): void {
        recorder.close('settled');
    }
    const assertContext = Object.assign(createRecordingAssertFacade(recorder, null), { collect: recorder.collect });
    function createScope(signal: AbortSignal): TestScope {
        const scope: TestScope = {
            debug: currentTestDebugScope(),
            seed,
            random: createTestRandom(seed),
            assert: assertContext,
            cleanup(callback) {
                registerCleanup(state, callback);
            },
            drainMicrotasks,
            plan: recorder.plan,
            require: createRecordingRequireFacade(recorder, null),
            settleAsyncWork,
            signal,
            startInFlight(operation) {
                return startInFlight(state, assertContext, operation);
            },
            yieldToNextTurn
        };
        return scopeWithAssertionSettlement(scope, closeRecording);
    }

    return {
        createScope,
        async finish(controller) {
            finishing = finishing ?? recorder.run(async function finishOwnedScope() {
                return await finish(controller);
            });
            return await finishing;
        },
        async runBody(signal, body) {
            return await runAssertionBody(function executeBody(): ReturnType<TestBody> {
                return recorder.run(function executeOwnedBody(): ReturnType<TestBody> {
                    return body(createScope(signal));
                });
            }, closeRecording);
        }
    };
}

type ReturnedScopeBody = { readonly kind: 'returned'; readonly value: AssertionResult; };
type ThrownScopeBody = { readonly kind: 'threw'; readonly error: unknown; };
type ScopeBodyCompletion = ReturnedScopeBody | ThrownScopeBody;

type ScopeInterruption = {
    readonly completion: Promise<ScopeBodyCompletion>;
    readonly finish: (settled: ScopeBodyCompletion) => void;
};

function watchAbort(signal: AbortSignal, interrupted: () => void): () => void {
    if (signal.aborted) {
        interrupted();
    } else {
        signal.addEventListener('abort', interrupted, { once: true });
    }
    return function stopWatching() {
        signal.removeEventListener('abort', interrupted);
    };
}

function observeScopeInterruption(boundaries: ScopeBodyBoundaries, recorder: AssertionRecorder): ScopeInterruption {
    const { parent, cancellation, ownerInterruption } = boundaries;
    const pending = Promise.withResolvers<ScopeBodyCompletion>();
    function interrupt(reason: unknown): void {
        recorder.close('interrupted');
        pending.resolve({ kind: 'threw', error: reason });
    }
    const stopOwner = watchAbort(ownerInterruption, function interruptFromOwner() {
        interrupt(ownerInterruption.reason);
    });
    const stopCancellation = watchAbort(cancellation, function interruptLocalTrial() {
        if (!parent.aborted || cancellation.reason !== parent.reason) {
            interrupt(cancellation.reason);
        }
    });
    return {
        completion: pending.promise,
        finish(settled) {
            pending.resolve(settled);
            stopOwner();
            stopCancellation();
        }
    };
}

async function scopeBodyCompletion(
    run: () => Promise<AssertionResult>,
    signal: AbortSignal
): Promise<ScopeBodyCompletion> {
    try {
        signal.throwIfAborted();
        return { kind: 'returned', value: await run() };
    } catch (error: unknown) {
        return { kind: 'threw', error };
    }
}

type ScopeBodyBoundaries = {
    readonly parent: AbortSignal;
    readonly cancellation: AbortSignal;
    readonly ownerInterruption: AbortSignal;
    readonly afterCleanup: () => Promise<void>;
};

type FinishedScopeBody = {
    readonly cleanup: FinishedScopeLifecycle;
    readonly completion: ScopeBodyCompletion;
};

export async function runScopeBodyWithInterruption(
    recorder: AssertionRecorder,
    context: CaseRandomContext,
    body: TestBody,
    boundaries: ScopeBodyBoundaries
): Promise<FinishedScopeBody> {
    const lifecycle = createTestScopeLifecycle(recorder, context);
    const controller = new AbortController();
    const signal = AbortSignal.any([ boundaries.parent, boundaries.cancellation, controller.signal ]);
    const interrupted = observeScopeInterruption(boundaries, recorder);
    const completion = await Promise.race([
        scopeBodyCompletion(async function executeBody() {
            return await lifecycle.runBody(signal, body);
        }, AbortSignal.any([ signal, boundaries.ownerInterruption ])),
        interrupted.completion
    ]);
    interrupted.finish(completion);
    const cleanup = await lifecycle.finish(controller);
    await boundaries.afterCleanup();
    return { cleanup, completion };
}

function createThrowingTestScope(
    recorder: AssertionRecorder,
    signal: AbortSignal,
    context: CaseRandomContext
): ThrowingTestScope {
    const seed = deriveCaseSeed(context.seed, context.work);
    return {
        debug: currentTestDebugScope(),
        seed,
        random: createTestRandom(seed),
        assert: createRecordingAssertFacade(recorder, null),
        require: createRecordingRequireFacade(recorder, null),
        signal
    };
}

export async function runThrowingTestBody(
    recorder: AssertionRecorder,
    signal: AbortSignal,
    context: CaseRandomContext,
    body: ThrowingTestBody
): Promise<void> {
    const scope = createThrowingTestScope(recorder, signal, context);
    await runAssertionBody(function executeBody(): ReturnType<ThrowingTestBody> {
        return recorder.run(function executeOwnedBody(): ReturnType<ThrowingTestBody> {
            return body(scope);
        });
    }, function closeRecording() {
        recorder.close('settled');
    });
}
