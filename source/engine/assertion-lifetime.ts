import { types } from 'node:util';
import { promiseHooks } from 'node:v8';
import { threadId } from 'node:worker_threads';
import { createStoredValue } from '../stored-value.ts';
import { attachAssertionBodyExecutor, sharedExecutionStorage } from '../execution-ownership.ts';
import { TestContractSignalError } from './assertion-control-error.ts';
import { currentLateAssertionSink } from './late-assertion-delivery.ts';
import type { AttemptId, CaseId, WorkId } from './identity.ts';
import type { PropertyTrialPosition } from './property-failure-evidence.ts';
import type { RunnerError, TestContractFailure } from './run-result.ts';

type PropertyTrialIdentity = {
    readonly kind: 'property';
    readonly invocation: string;
    readonly position: PropertyTrialPosition;
} | { readonly kind: 'unlabelled-trial'; readonly index: number; };

export type AssertionOrigin = {
    readonly case: CaseId;
    readonly work: WorkId;
    readonly attempt: AttemptId;
    readonly trial: PropertyTrialIdentity | null;
};

type AssertionClosure = 'interrupted' | 'settled';

type AssertionBody<Value> = () => Promise<Value> | Value;

type SettlementObservation = {
    readonly invoke: <Result>(body: () => Result) => Result;
    readonly track: (promise: Promise<unknown>, close: () => void) => () => void;
    readonly retain: () => void;
    readonly release: () => void;
};

const settlement = createStoredValue<SettlementObservation | null>(null);

function observeSettlement(): SettlementObservation {
    const settled = new WeakSet<Promise<unknown>>();
    const pending = new WeakMap<Promise<unknown>, Set<() => void>>();
    let users = 0;
    let invoking = 0;
    const stop = promiseHooks.onSettled(function closeSettledBody(promise: Promise<unknown>) {
        const closers = pending.get(promise);
        if (invoking > 0) {
            settled.add(promise);
        }
        if (closers !== undefined) {
            pending.delete(promise);
            for (const close of closers) {
                close();
            }
        }
    });

    return {
        invoke<Result>(body: () => Result): Result {
            invoking += 1;
            try {
                return body();
            } finally {
                invoking -= 1;
            }
        },
        track(promise, close) {
            if (settled.has(promise)) {
                close();
            }
            const closers = pending.get(promise) ?? new Set<() => void>();
            closers.add(close);
            pending.set(promise, closers);
            return function untrack() {
                closers.delete(close);
            };
        },
        retain() {
            users += 1;
        },
        release() {
            users -= 1;
            if (users === 0) {
                Reflect.apply(stop, undefined, []);
                settlement.write(null);
            }
        }
    };
}

export async function withAssertionSettlement<Value>(run: () => Promise<Value>): Promise<Value> {
    const observation = settlement.read() ?? observeSettlement();
    settlement.write(observation);
    observation.retain();
    try {
        return await run();
    } finally {
        observation.release();
    }
}

function invokeAssertionBody<Result>(body: () => Result, close: () => void): Result {
    const observation = settlement.read();
    try {
        return observation === null ? body() : observation.invoke(body);
    } catch (error: unknown) {
        close();
        throw error;
    }
}

export function observeAssertionBody<Result>(body: () => Result, close: () => void): Result {
    const result = invokeAssertionBody(body, close);
    if (types.isPromise(result)) {
        const untrack = settlement.read()?.track(result, close);
        function finish(): void {
            untrack?.();
            close();
        }
        result.then(finish, finish);
    } else {
        close();
    }
    return result;
}

export async function runAssertionBody<Value>(body: AssertionBody<Value>, close: () => void): Promise<Value> {
    const value = invokeAssertionBody(body, close);
    if (!types.isPromise(value)) {
        close();
        return value;
    }
    const untrack = settlement.read()?.track(value, close);
    try {
        return await value;
    } finally {
        untrack?.();
        close();
    }
}

export function scopeWithAssertionSettlement<Scope extends Readonly<Record<string, unknown>>>(
    scope: Scope,
    close: () => void
): Scope {
    return attachAssertionBodyExecutor(scope, async function executeBody(body) {
        return await runAssertionBody(body, close);
    });
}

export type LateAssertionActivity = {
    readonly kind: 'late-assertion-activity';
    readonly origin: AssertionOrigin;
    readonly operation: string;
    readonly closure: AssertionClosure;
};

function lateAssertionFailure(activity: LateAssertionActivity): TestContractFailure {
    return Object.freeze({
        actual: activity,
        code: 'late-assertion-activity',
        expected: 'an open assertion recording context',
        kind: 'test-contract',
        summary: `Cannot ${activity.operation} after the assertion context ${activity.closure}.`
    });
}

const diagnosticSequenceKey = Symbol.for('@overkill-dev/late-assertion-sequence/v1');
const firstDiagnosticSequence = 0n;
const diagnosticSequenceIncrement = 1n;

function nextDiagnosticId(): string {
    const previous: unknown = Reflect.get(globalThis, diagnosticSequenceKey);
    const sequence = typeof previous === 'bigint' ? previous + diagnosticSequenceIncrement : firstDiagnosticSequence;
    Reflect.set(globalThis, diagnosticSequenceKey, sequence);
    return `${process.pid}:${threadId}:${sequence}`;
}

export function lateAssertionDiagnostic(activity: LateAssertionActivity, message: string): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        attributedToWork: null,
        cause: { ...activity, id: nextDiagnosticId() },
        diagnostics: [ { label: 'assertion origin', value: JSON.stringify(activity.origin) } ],
        message,
        subtype: 'attribution-drift'
    };
}

export function lateAssertionDiagnosticId(error: RunnerError): string | null {
    const { cause } = error;
    if (error.subtype !== 'attribution-drift' || typeof cause !== 'object' || cause === null) {
        return null;
    }
    const kind: unknown = Reflect.get(cause, 'kind');
    const id: unknown = Reflect.get(cause, 'id');
    return kind === 'late-assertion-activity' && typeof id === 'string' ? id : null;
}

export function retainUniqueLateAssertionDiagnostics(errors: readonly RunnerError[]): readonly RunnerError[] {
    const seen = new Set<string>();
    return errors.filter(function uniqueDiagnostic(error) {
        const id = lateAssertionDiagnosticId(error);
        if (id === null) {
            return true;
        }
        if (seen.has(id)) {
            return false;
        }
        seen.add(id);
        return true;
    });
}

export type AssertionRecordingContext = {
    readonly origin: AssertionOrigin;
    readonly run: <Value>(operation: () => Value) => Value;
    readonly assertRecording: (operation: string) => void;
    readonly fail: (failure: TestContractFailure) => never;
    readonly child: () => AssertionRecordingContext;
    readonly close: (reason: AssertionClosure) => void;
};

type ActiveAssertionContext = {
    readonly origin: AssertionOrigin;
    readonly assertOpen: (operation: string) => void;
    readonly fail: AssertionRecordingContext['fail'];
};

const activeAssertions = sharedExecutionStorage<ActiveAssertionContext>(
    Symbol.for('@overkill-dev/engine/active-assertions/v1')
);

export type AssertionContext = AssertionRecordingContext & {
    readonly interruption: AbortSignal;
    readonly publish: () => void;
    readonly lateFailures: () => readonly TestContractFailure[];
    readonly acceptsPropertyEvidence: () => boolean;
};

type OwnedAssertionContext = {
    readonly owner: symbol;
    readonly lifetime: AssertionContext;
};

export function createAssertionContext(
    origin: AssertionOrigin,
    retainFailure: (failure: TestContractFailure) => void
): OwnedAssertionContext {
    const reportLate = currentLateAssertionSink();
    const interruption = new AbortController();
    const lateFailures: TestContractFailure[] = [];
    let state: {
        readonly kind: 'closed' | 'published';
        readonly closure: AssertionClosure;
    } | { readonly kind: 'recording'; } = { kind: 'recording' };

    function fail(failure: TestContractFailure): never {
        const recorded = Object.freeze({ ...failure });
        retainFailure(recorded);
        throw new TestContractSignalError(recorded, undefined);
    }

    function rejectLate(operation: string, closure: AssertionClosure): never {
        const activity = { kind: 'late-assertion-activity', origin, operation, closure } as const;
        const failure = lateAssertionFailure(activity);
        if (state.kind === 'published') {
            reportLate(lateAssertionDiagnostic(activity, failure.summary));
        } else {
            lateFailures.push(failure);
            retainFailure(failure);
        }
        throw new TestContractSignalError(failure, undefined);
    }

    function assertOpen(operation: string): void {
        if (state.kind !== 'recording') {
            rejectLate(operation, state.closure);
        }
    }

    function recordingContext(
        assertContextOpen: (operation: string) => void,
        close: (reason: AssertionClosure) => void
    ): AssertionRecordingContext {
        const context = { origin, assertOpen: assertContextOpen, fail };
        return {
            origin,
            run(operation) {
                return activeAssertions.run(context, operation);
            },
            assertRecording(operation) {
                assertContextOpen(operation);
                const active = activeAssertions.getStore();
                if (active !== undefined && active !== context) {
                    active.assertOpen(operation);
                    active.fail({
                        actual: {
                            reason: 'wrong-active-context',
                            operation,
                            origin: active.origin,
                            destination: origin
                        },
                        code: 'invalid-assertion-context',
                        expected: 'the injected assertion context for the active callback',
                        kind: 'test-contract',
                        summary: `Cannot ${operation} through a different assertion context.`
                    });
                }
            },
            fail,
            child() {
                let closure: AssertionClosure | null = null;
                return recordingContext(function assertChildOpen(operation) {
                    if (closure !== null) {
                        rejectLate(operation, closure);
                    }
                    assertContextOpen(operation);
                }, function closeChild(reason) {
                    closure ??= reason;
                });
            },
            close
        };
    }

    const recording = recordingContext(assertOpen, function closeRoot(reason) {
        if (state.kind === 'recording') {
            state = { kind: 'closed', closure: reason };
            if (reason === 'interrupted') {
                interruption.abort();
            }
        }
    });

    return {
        owner: Symbol('assertion recorder'),
        lifetime: {
            interruption: interruption.signal,
            ...recording,
            acceptsPropertyEvidence() {
                return state.kind === 'recording' || state.kind === 'closed' && state.closure === 'settled';
            },
            lateFailures() {
                return lateFailures.slice();
            },
            publish() {
                if (state.kind === 'closed') {
                    state = { kind: 'published', closure: state.closure };
                }
            }
        }
    };
}
