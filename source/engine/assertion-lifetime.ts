import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { promiseHooks } from 'node:v8';
import { createStoredValue } from '../stored-value.ts';
import type { AttemptId, CaseId, WorkId } from './identity.ts';
import type { PropertyTrialPosition } from './property-failure-evidence.ts';
import type { RunnerError, TestContractFailure } from './run-result.ts';

export type PropertyTrialIdentity =
    | { readonly kind: 'property'; readonly invocation: string; readonly position: PropertyTrialPosition; }
    | { readonly kind: 'unlabelled-trial'; readonly index: number; };

export type AssertionOrigin = {
    readonly case: CaseId;
    readonly work: WorkId;
    readonly attempt: AttemptId;
    readonly trial: PropertyTrialIdentity | null;
};

export type AssertionClosure = 'interrupted' | 'settled';

type SettlementObservation = {
    readonly track: (promise: Promise<unknown>, close: () => void) => () => void;
    readonly retain: () => void;
    readonly release: () => void;
};

const settlement = createStoredValue<SettlementObservation | null>(null);

function observeSettlement(): SettlementObservation {
    const settled = new WeakSet<Promise<unknown>>();
    const pending = new WeakMap<Promise<unknown>, Set<() => void>>();
    let users = 0;
    const stop = promiseHooks.onSettled(function closeSettledBody(promise: Promise<unknown>) {
        const closers = pending.get(promise);
        pending.delete(promise);
        settled.add(promise);
        closers?.forEach(function closeRecorder(close) {
            close();
        });
    });

    return {
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

function invokeBody<Value>(body: () => Promise<Value> | Value, close: () => void): Promise<Value> | Value {
    try {
        return body();
    } catch (error: unknown) {
        close();
        throw error;
    }
}

export async function runAssertionBody<Value>(body: () => Promise<Value> | Value, close: () => void): Promise<Value> {
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

export function lateAssertionDiagnostic(activity: LateAssertionActivity, message: string): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        attributedToWork: null,
        cause: { ...activity, id: randomUUID() },
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
