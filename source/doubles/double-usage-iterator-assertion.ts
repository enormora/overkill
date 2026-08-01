import { defineCompositeAssertion } from '../assert/assertion-extension.ts';
import type { DoubleIteratorEvent } from './double-history-record.ts';
import {
    type AssertionCheck,
    type AssertionResult,
    type CountArguments,
    groupChildren,
    type IteratorValuesArguments,
    type UsageAssertionReference,
    type ValueArguments
} from './double-usage-contract.ts';
import {
    inspectedDouble,
    validNonNegativeInteger
} from './double-usage-inspection.ts';

type IteratorCountCheckInput = {
    readonly check: AssertionCheck;
    readonly expectedCount: number;
    readonly subject: unknown;
    readonly value: 'event' | 'yield';
};

type IteratorEventHistory = {
    readonly iteratorEvents: readonly DoubleIteratorEvent[];
};

function iteratorEventCount(check: AssertionCheck, subject: unknown): AssertionResult {
    const inspected = inspectedDouble(check, subject);

    return inspected.valid
        ? check.annotated('iterator event count').greaterThan(inspected.history.iteratorEventCount, 0)
        : inspected.failure;
}

function noIteratorEvents(check: AssertionCheck, subject: unknown): AssertionResult {
    const inspected = inspectedDouble(check, subject);

    return inspected.valid
        ? check.annotated('iterator event count').equal(inspected.history.iteratorEventCount, 0)
        : inspected.failure;
}

function yieldedValues(history: IteratorEventHistory): readonly unknown[] {
    return history
        .iteratorEvents
        .filter(function yieldedEvent(event) {
            return event.kind === 'yield';
        })
        .map(function yieldedValue(event) {
            return event.value;
        });
}

function iteratorCountAssertion(input: IteratorCountCheckInput): AssertionResult {
    const inspected = inspectedDouble(input.check, input.subject);

    if (!inspected.valid) {
        return inspected.failure;
    }

    const actualCount = input.value === 'event'
        ? inspected.history.iteratorEventCount
        : yieldedValues(inspected.history).length;

    return input.check.group([
        input.check.annotated('expected count').true(validNonNegativeInteger(input.expectedCount)),
        input.check.annotated(input.value === 'event' ? 'iterator event count' : 'yield count').equal(
            actualCount,
            input.expectedCount
        )
    ]);
}

function yieldedExactlyAssertion(
    check: AssertionCheck,
    subject: unknown,
    expectedValues: readonly unknown[]
): AssertionResult {
    const inspected = inspectedDouble(check, subject);

    if (!inspected.valid) {
        return inspected.failure;
    }

    return groupChildren(check, [
        check.annotated('yielded values').deepEqual(yieldedValues(inspected.history), expectedValues)
    ], 'yielded values');
}

export function iteratedReference(name: string): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert: iteratorEventCount,
        formatSummary() {
            return 'Expected double iterator to have been consumed.';
        },
        name
    });
}

export function notIteratedReference(name: string): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert: noIteratorEvents,
        formatSummary() {
            return 'Expected double iterator not to have been consumed.';
        },
        name
    });
}

export function iteratorEventCountReference(name: string): UsageAssertionReference<CountArguments> {
    return defineCompositeAssertion<CountArguments, AssertionResult>({
        assert(check, subject: unknown, expectedCount: number) {
            return iteratorCountAssertion({ check, expectedCount, subject, value: 'event' });
        },
        formatSummary() {
            return 'Expected double iterator event count to match.';
        },
        name
    });
}

export function yieldCountReference(name: string): UsageAssertionReference<CountArguments> {
    return defineCompositeAssertion<CountArguments, AssertionResult>({
        assert(check, subject: unknown, expectedCount: number) {
            return iteratorCountAssertion({ check, expectedCount, subject, value: 'yield' });
        },
        formatSummary() {
            return 'Expected double yield count to match.';
        },
        name
    });
}

export function yieldedExactlyReference(name: string): UsageAssertionReference<IteratorValuesArguments> {
    return defineCompositeAssertion<IteratorValuesArguments, AssertionResult>({
        assert: yieldedExactlyAssertion,
        formatSummary() {
            return 'Expected double yielded values to match exactly.';
        },
        name
    });
}
