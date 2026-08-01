import { defineCompositeAssertion } from '../assert/assertion-extension.ts';
import {
    type AssertionCheck,
    type AssertionResult,
    type CountArguments,
    modeNoun,
    type UsageAssertionReference,
    type UsageMode,
    type ValueArguments
} from './double-usage-contract.ts';
import {
    countFor,
    inspectedDouble,
    validNonNegativeInteger
} from './double-usage-inspection.ts';

type CountCheckInput = {
    readonly check: AssertionCheck;
    readonly expectedCount: number;
    readonly mode: UsageMode;
    readonly subject: unknown;
};

function countAssertion(input: CountCheckInput): AssertionResult {
    const inspected = inspectedDouble(input.check, input.subject);

    if (!inspected.valid) {
        return inspected.failure;
    }

    return input.check.group([
        input.check.annotated('expected count').true(validNonNegativeInteger(input.expectedCount)),
        input.check.annotated(`${modeNoun(input.mode)} count`).equal(
            countFor(inspected.history, input.mode),
            input.expectedCount
        )
    ]);
}

function atLeastOneAssertion(check: AssertionCheck, subject: unknown, mode: UsageMode): AssertionResult {
    const inspected = inspectedDouble(check, subject);

    return inspected.valid
        ? check.annotated(`${modeNoun(mode)} count`).greaterThan(countFor(inspected.history, mode), 0)
        : inspected.failure;
}

function noEventsAssertion(check: AssertionCheck, subject: unknown, mode: UsageMode): AssertionResult {
    const inspected = inspectedDouble(check, subject);

    return inspected.valid
        ? check.annotated(`${modeNoun(mode)} count`).equal(countFor(inspected.history, mode), 0)
        : inspected.failure;
}

function onceAssertion(check: AssertionCheck, subject: unknown, mode: UsageMode): AssertionResult {
    return countAssertion({ check, expectedCount: 1, mode, subject });
}

export function countReference(
    name: string,
    mode: UsageMode
): UsageAssertionReference<CountArguments> {
    return defineCompositeAssertion<CountArguments, AssertionResult>({
        assert(check, subject: unknown, expectedCount: number) {
            return countAssertion({ check, expectedCount, mode, subject });
        },
        formatSummary() {
            return `Expected double ${modeNoun(mode)} count to match.`;
        },
        name
    });
}

export function atLeastOneReference(
    name: string,
    mode: UsageMode
): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert(check, subject: unknown) {
            return atLeastOneAssertion(check, subject, mode);
        },
        formatSummary() {
            return `Expected double to have at least one ${modeNoun(mode)}.`;
        },
        name
    });
}

export function noEventsReference(
    name: string,
    mode: UsageMode
): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert(check, subject: unknown) {
            return noEventsAssertion(check, subject, mode);
        },
        formatSummary() {
            return `Expected double not to have ${modeNoun(mode)}s.`;
        },
        name
    });
}

export function onceReference(name: string, mode: UsageMode): UsageAssertionReference<ValueArguments> {
    return defineCompositeAssertion<ValueArguments, AssertionResult>({
        assert(check, subject: unknown) {
            return onceAssertion(check, subject, mode);
        },
        formatSummary() {
            return `Expected double to have exactly one ${modeNoun(mode)}.`;
        },
        name
    });
}
