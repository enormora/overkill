import { types } from 'node:util';
import { promiseHooks } from 'node:v8';
import { threadId } from 'node:worker_threads';
import { createStoredValue } from '../stored-value.ts';
import { attachAssertionBodyExecutor } from '../execution-ownership.ts';
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

export type AssertionClosure = 'interrupted' | 'settled';

type AssertionBody<Value> = () => Promise<Value> | Value;

type SettlementObservation = {
    readonly invoke: <Value>(body: AssertionBody<Value>) => Promise<Value> | Value;
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
        invoke<Value>(body: AssertionBody<Value>): Promise<Value> | Value {
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

function invokeBody<Value>(body: AssertionBody<Value>, close: () => void): Promise<Value> | Value {
    const observation = settlement.read();
    const execute = observation === null ? body : function executeObservedBody(): Promise<Value> | Value {
        return observation.invoke(body);
    };
    try {
        return execute();
    } catch (error: unknown) {
        close();
        throw error;
    }
}

export async function runAssertionBody<Value>(body: AssertionBody<Value>, close: () => void): Promise<Value> {
    const value = invokeBody(body, close);
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

export function lateAssertionFailure(activity: LateAssertionActivity): TestContractFailure {
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

export type AssertionContext = {
    readonly origin: AssertionOrigin;
    readonly interruption: AbortSignal;
    readonly close: (reason: AssertionClosure) => void;
    readonly publish: () => void;
    readonly assertRecording: (operation: string) => void;
    readonly lateFailures: () => readonly TestContractFailure[];
    readonly acceptsPropertyEvidence: () => boolean;
};

export function createAssertionContext(
    origin: AssertionOrigin,
    retainFailure: (failure: TestContractFailure) => void
): AssertionContext & { readonly owner: symbol; } {
    const reportLate = currentLateAssertionSink();
    const interruption = new AbortController();
    const lateFailures: TestContractFailure[] = [];
    let state: {
        readonly kind: 'closed' | 'published';
        readonly closure: AssertionClosure;
    } | { readonly kind: 'recording'; } = { kind: 'recording' };

    function assertRecording(operation: string): void {
        if (state.kind === 'recording') {
            return;
        }
        const activity = { kind: 'late-assertion-activity', origin, operation, closure: state.closure } as const;
        const failure = lateAssertionFailure(activity);
        if (state.kind === 'closed') {
            lateFailures.push(failure);
            retainFailure(failure);
        } else {
            reportLate(lateAssertionDiagnostic(activity, failure.summary));
        }
        throw new TestContractSignalError(failure, undefined);
    }

    return {
        origin,
        owner: Symbol('assertion recorder'),
        interruption: interruption.signal,
        assertRecording,
        acceptsPropertyEvidence() {
            return state.kind === 'recording' || state.kind === 'closed' && state.closure === 'settled';
        },
        lateFailures() {
            return lateFailures.slice();
        },
        close(reason) {
            if (state.kind === 'recording') {
                state = { kind: 'closed', closure: reason };
                if (reason === 'interrupted') {
                    interruption.abort();
                }
            }
        },
        publish() {
            if (state.kind === 'closed') {
                state = { kind: 'published', closure: state.closure };
            }
        }
    };
}
