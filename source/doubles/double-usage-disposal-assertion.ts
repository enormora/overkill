import { defineCompositeAssertion } from '../assert/assertion-extension.ts';
import type { ChronologyOrder } from './double-chronology.ts';
import {
    type AssertionCheck,
    type AssertionChild,
    type AssertionResult,
    groupChildren,
    type CountArguments,
    type OrderArguments,
    type UsageAssertionReference,
    type ValueArguments
} from './double-usage-contract.ts';
import {
    chronologyFor,
    inspectedDouble,
    validNonNegativeInteger,
    type ValidDoubleInspection
} from './double-usage-inspection.ts';
import { protocolDisposeMethod } from './protocol-double-metadata.ts';

type DisposalInspection = {
    readonly failure: AssertionChild;
    readonly valid: false;
} | {
    readonly inspection: ValidDoubleInspection;
    readonly valid: true;
};

const minimumOrderedDisposables = 2;

function invalidDisposableFailure(check: AssertionCheck): AssertionChild {
    return check.fromThrowable('test disposable', function expectedTestDisposable() {
        throw new TypeError('Expected an Overkill test disposable.');
    });
}

function inspectedDisposal(check: AssertionCheck, subject: unknown): DisposalInspection {
    const disposeMethod = protocolDisposeMethod(subject);

    if (disposeMethod === null) {
        return {
            failure: invalidDisposableFailure(check),
            valid: false
        };
    }

    const inspection = inspectedDouble(check, disposeMethod);

    return inspection.valid
        ? {
            inspection,
            valid: true
        }
        : {
            failure: inspection.failure,
            valid: false
        };
}

function disposalCount(check: AssertionCheck, subject: unknown): AssertionResult {
    const inspected = inspectedDisposal(check, subject);

    return inspected.valid
        ? check.annotated('dispose count').greaterThan(inspected.inspection.history.callCount, 0)
        : inspected.failure;
}

function noDisposal(check: AssertionCheck, subject: unknown): AssertionResult {
    const inspected = inspectedDisposal(check, subject);

    return inspected.valid
        ? check.annotated('dispose count').equal(inspected.inspection.history.callCount, 0)
        : inspected.failure;
}

function disposalOnce(check: AssertionCheck, subject: unknown): AssertionResult {
    const inspected = inspectedDisposal(check, subject);

    return inspected.valid
        ? check.annotated('dispose count').equal(inspected.inspection.history.callCount, 1)
        : inspected.failure;
}

function expectedDisposalCount(check: AssertionCheck, subject: unknown, expectedCount: number): AssertionResult {
    const inspected = inspectedDisposal(check, subject);

    if (!inspected.valid) {
        return inspected.failure;
    }

    return check.group([
        check.annotated('expected count').true(validNonNegativeInteger(expectedCount)),
        check.annotated('dispose count').equal(inspected.inspection.history.callCount, expectedCount)
    ]);
}

function inspectDisposables(check: AssertionCheck, disposables: readonly unknown[]): {
    readonly inspections: readonly ValidDoubleInspection[];
    readonly valid: true;
} | {
    readonly result: AssertionResult;
    readonly valid: false;
} {
    const inspections: ValidDoubleInspection[] = [];
    const failures: AssertionChild[] = [];

    for (const disposable of disposables) {
        const inspected = inspectedDisposal(check, disposable);

        if (inspected.valid) {
            inspections.push(inspected.inspection);
        } else {
            failures.push(inspected.failure);
        }
    }

    return failures.length === 0
        ? {
            inspections,
            valid: true
        }
        : {
            result: groupChildren(check, failures, 'disposal'),
            valid: false
        };
}

function hasMixedScope(inspections: readonly ValidDoubleInspection[]): boolean {
    const firstScope = inspections[0]?.chronology.scope;

    return inspections.some(function hasDifferentScope(inspection) {
        return inspection.chronology.scope !== firstScope;
    });
}

function sharedScopeFailure(check: AssertionCheck): AssertionResult {
    return check.fromThrowable('dispose order', function expectedSharedScope() {
        throw new TypeError('Expected ordered disposables to belong to the same double scope.');
    });
}

function disposalEventGroups(inspections: readonly ValidDoubleInspection[]): readonly (readonly ChronologyOrder[])[] {
    return inspections.map(function eventsFor(inspection) {
        return chronologyFor(inspection.chronology, 'call');
    });
}

function missingDisposalChecks(
    check: AssertionCheck,
    eventGroups: readonly (readonly ChronologyOrder[])[]
): readonly AssertionChild[] {
    return eventGroups.flatMap(function missingEvents(events, index) {
        return events.length === 0 ? [ check.annotated(`dispose ${index}`).notEmpty(events) ] : [];
    });
}

function disposalOrderChecks(
    check: AssertionCheck,
    eventGroups: readonly (readonly ChronologyOrder[])[]
): readonly AssertionChild[] {
    return eventGroups.slice(0, -1).flatMap(function pairOrder(previousEvents, index) {
        const nextEvents = eventGroups[index + 1] ?? [];
        const previousLast = previousEvents.at(-1);
        const nextFirst = nextEvents[0];

        return previousLast === undefined || nextFirst === undefined ? [] : [
            check.annotated(`dispose order ${index} before ${index + 1}`).lessThan(previousLast.order, nextFirst.order)
        ];
    });
}

function disposalOrder(check: AssertionCheck, disposables: readonly unknown[]): AssertionResult {
    if (disposables.length < minimumOrderedDisposables) {
        return check.fromThrowable('dispose order', function expectedDisposalOrder() {
            throw new TypeError('Expected at least two disposables.');
        });
    }

    const inspected = inspectDisposables(check, disposables);

    if (!inspected.valid) {
        return inspected.result;
    }

    if (hasMixedScope(inspected.inspections)) {
        return sharedScopeFailure(check);
    }

    const eventGroups = disposalEventGroups(inspected.inspections);

    return groupChildren(check, [
        ...missingDisposalChecks(check, eventGroups),
        ...disposalOrderChecks(check, eventGroups)
    ], 'dispose order');
}

export function disposedReference(name: string): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert: disposalCount,
        formatSummary() {
            return 'Expected disposable to have been disposed.';
        },
        name
    });
}

export function notDisposedReference(name: string): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert: noDisposal,
        formatSummary() {
            return 'Expected disposable not to have been disposed.';
        },
        name
    });
}

export function disposedOnceReference(name: string): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert: disposalOnce,
        formatSummary() {
            return 'Expected disposable to have been disposed once.';
        },
        name
    });
}

export function disposeCountReference(name: string): UsageAssertionReference<CountArguments> {
    return defineCompositeAssertion<CountArguments, AssertionResult>({
        assert: expectedDisposalCount,
        formatSummary() {
            return 'Expected dispose count to match.';
        },
        name
    });
}

export function disposeOrderReference(name: string): UsageAssertionReference<OrderArguments> {
    return defineCompositeAssertion<OrderArguments, AssertionResult>({
        assert: disposalOrder,
        formatSummary() {
            return 'Expected dispose order to match.';
        },
        name
    });
}
