import {
    doubleChronology,
    type ChronologyOrder,
    type DoubleChronology
} from './double-chronology.ts';
import type {
    DoubleCall,
    DoubleConstruction,
    DoubleInteraction
} from './double-history-record.ts';
import type {
    AssertionCheck,
    AssertionChild,
    UsageMode
} from './double-usage-contract.ts';
import type { DoubleHistory } from './test-double.ts';

export type EventRecord = DoubleCall | DoubleConstruction | DoubleInteraction;
type HistoryShape = DoubleHistory<unknown>;

export type ValidDoubleInspection = {
    readonly chronology: DoubleChronology;
    readonly history: HistoryShape;
    readonly valid: true;
};

export type DoubleInspection = ValidDoubleInspection | {
    readonly failure: AssertionChild;
    readonly valid: false;
};

export function recordsFor(history: HistoryShape, mode: UsageMode): readonly EventRecord[] {
    if (mode === 'call') {
        return history.calls;
    }

    return mode === 'construction' ? history.constructions : history.interactions;
}

export function chronologyFor(chronology: DoubleChronology, mode: UsageMode): readonly ChronologyOrder[] {
    if (mode === 'call') {
        return chronology.calls;
    }

    return mode === 'construction' ? chronology.constructions : chronology.interactions;
}

export function countFor(history: HistoryShape, mode: UsageMode): number {
    if (mode === 'call') {
        return history.callCount;
    }

    return mode === 'construction' ? history.constructionCount : history.interactionCount;
}

function hasNumberHistoryProperties(value: unknown): boolean {
    return typeof value === 'function' &&
        typeof Reflect.get(value, 'callCount') === 'number' &&
        typeof Reflect.get(value, 'constructionCount') === 'number' &&
        typeof Reflect.get(value, 'interactionCount') === 'number' &&
        typeof Reflect.get(value, 'iteratorEventCount') === 'number';
}

function hasArrayHistoryProperties(value: unknown): boolean {
    return typeof value === 'function' &&
        Array.isArray(Reflect.get(value, 'calls')) &&
        Array.isArray(Reflect.get(value, 'constructions')) &&
        Array.isArray(Reflect.get(value, 'interactions')) &&
        Array.isArray(Reflect.get(value, 'iteratorEvents'));
}

function isHistoryShape(value: unknown): value is HistoryShape {
    return hasNumberHistoryProperties(value) &&
        hasArrayHistoryProperties(value);
}

function invalidDoubleFailure(check: AssertionCheck): AssertionChild {
    return check.fromThrowable('test double', function expectedTestDouble() {
        throw new TypeError('Expected an Overkill test double.');
    });
}

export function inspectedDouble(check: AssertionCheck, subject: unknown): DoubleInspection {
    const chronology = doubleChronology(subject);

    return chronology === null || !isHistoryShape(subject)
        ? {
            failure: invalidDoubleFailure(check),
            valid: false
        }
        : {
            chronology,
            history: subject,
            valid: true
        };
}

export function validNonNegativeInteger(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
}
