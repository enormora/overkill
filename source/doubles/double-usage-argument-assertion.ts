import { defineCompositeAssertion } from '../assert/assertion-extension.ts';
import { compareExactly, comparePartially } from '../compare/raw-comparison.ts';
import {
    type AggregateArguments,
    type AggregateIndexedArguments,
    type AggregateIndexedPrefixArguments,
    type AggregatePrefixArguments,
    type ArgumentMatch,
    type AssertionCheck,
    type AssertionResult,
    groupChildren,
    modeNoun,
    type UsageAssertionReference,
    type UsageMode
} from './double-usage-contract.ts';
import {
    type EventRecord,
    inspectedDouble,
    recordsFor,
    validNonNegativeInteger
} from './double-usage-inspection.ts';

type NonEmptyAnyArguments = readonly [unknown, ...unknown[]];

type ArgumentCheckInput = {
    readonly args: readonly unknown[];
    readonly check: AssertionCheck;
    readonly match: ArgumentMatch;
    readonly mode: UsageMode;
    readonly negative: boolean;
    readonly position: 'any' | 'last' | 'nth' | 'once';
    readonly subject: unknown;
};

type ArgumentReferenceConfiguration = {
    readonly match: ArgumentMatch;
    readonly mode: UsageMode;
    readonly negative: boolean;
    readonly position: ArgumentCheckInput['position'];
};

type ArgumentPrefixReferenceConfiguration = {
    readonly mode: UsageMode;
    readonly negative: boolean;
    readonly position: ArgumentCheckInput['position'];
};

type IndexedArgumentCheckInput = {
    readonly args: readonly unknown[];
    readonly check: AssertionCheck;
    readonly index: number;
    readonly match: ArgumentMatch;
    readonly mode: UsageMode;
    readonly subject: unknown;
};

type ArgumentFailureInput = {
    readonly check: AssertionCheck;
    readonly expectedArguments: readonly unknown[];
    readonly label: string;
    readonly match: ArgumentMatch;
    readonly records: readonly EventRecord[];
};

type SpecificArgumentCheckInput = {
    readonly check: AssertionCheck;
    readonly expectedArguments: readonly unknown[];
    readonly label: string;
    readonly match: ArgumentMatch;
    readonly record: EventRecord | null;
};

function partialArgumentsMatch(actual: readonly unknown[], expected: readonly unknown[]): boolean {
    return actual.length === expected.length &&
        expected.every(function argumentMatches(expectedArgument, index) {
            return comparePartially(actual[index], expectedArgument);
        });
}

function prefixArgumentsMatch(actual: readonly unknown[], expected: readonly unknown[]): boolean {
    return actual.length >= expected.length &&
        expected.every(function argumentMatches(expectedArgument, index) {
            return comparePartially(actual[index], expectedArgument);
        });
}

function argumentsMatch(actual: readonly unknown[], expected: readonly unknown[], match: ArgumentMatch): boolean {
    if (match === 'exact') {
        return compareExactly(actual, expected);
    }

    return match === 'prefix'
        ? prefixArgumentsMatch(actual, expected)
        : partialArgumentsMatch(actual, expected);
}

function matchingRecords(
    records: readonly EventRecord[],
    expectedArguments: readonly unknown[],
    match: ArgumentMatch
): readonly EventRecord[] {
    return records.filter(function recordMatches(record) {
        return argumentsMatch(record.arguments, expectedArguments, match);
    });
}

function sameArityArguments(
    records: readonly EventRecord[],
    expectedArguments: readonly unknown[]
): readonly (readonly unknown[])[] {
    return records
        .map(function recordArguments(record) {
            return record.arguments;
        })
        .filter(function sameLength(actualArguments) {
            return actualArguments.length === expectedArguments.length;
        });
}

function positiveArgumentFailure(input: ArgumentFailureInput): AssertionResult {
    if (input.match === 'prefix') {
        return input.check.annotated(input.label).arrayContainsPartial(
            input.records.map(function recordArguments(record) {
                return record.arguments;
            }),
            input.expectedArguments
        );
    }

    if (input.match === 'partial') {
        return input.check.annotated(input.label).membersPartialDeepEqual(
            sameArityArguments(input.records, input.expectedArguments),
            [ input.expectedArguments ]
        );
    }

    const firstSameArity = sameArityArguments(input.records, input.expectedArguments)[0];

    return firstSameArity === undefined
        ? input.check.annotated(`${input.label} arity`).true(false)
        : input.check.annotated(input.label).deepEqual(firstSameArity, input.expectedArguments);
}

function specificArgumentCheck(input: SpecificArgumentCheckInput): AssertionResult {
    if (input.record === null) {
        return input.check.annotated(input.label).notNull(input.record);
    }

    if (input.match === 'exact') {
        return input.check.annotated(input.label).deepEqual(input.record.arguments, input.expectedArguments);
    }

    return input.match === 'prefix'
        ? input.check.annotated(input.label).partialDeepEqual(input.record.arguments, input.expectedArguments)
        : input.check.group([
            input.check.annotated(`${input.label} count`).length(
                input.record.arguments,
                input.expectedArguments.length
            ),
            input.check.annotated(input.label).partialDeepEqual(input.record.arguments, input.expectedArguments)
        ]);
}

function emptyPrefixFailure(
    check: AssertionCheck,
    match: ArgumentMatch,
    args: readonly unknown[]
): AssertionResult | null {
    return match === 'prefix' && args.length === 0
        ? check.fromThrowable('expected argument prefix', function expectedArgumentPrefix() {
            throw new TypeError('Expected argument prefix to contain at least one item.');
        })
        : null;
}

function anyArgumentAssertion(input: ArgumentCheckInput, records: readonly EventRecord[]): AssertionResult {
    const label = `${modeNoun(input.mode)} arguments`;
    const matched = matchingRecords(records, input.args, input.match).length > 0;

    if (input.negative) {
        return input.check.annotated(label).false(matched);
    }

    return matched
        ? input.check.annotated(label).true(true)
        : positiveArgumentFailure({
            check: input.check,
            expectedArguments: input.args,
            label,
            match: input.match,
            records
        });
}

function onceArgumentAssertion(input: ArgumentCheckInput, records: readonly EventRecord[]): AssertionResult {
    const label = `${modeNoun(input.mode)} arguments`;
    const children = [
        input.check.annotated(`${modeNoun(input.mode)} count`).equal(records.length, 1),
        ...records[0] === undefined ? [] : [
            specificArgumentCheck({
                check: input.check,
                expectedArguments: input.args,
                label,
                match: input.match,
                record: records[0]
            })
        ]
    ];

    return groupChildren(input.check, children, label);
}

function lastArgumentAssertion(input: ArgumentCheckInput, records: readonly EventRecord[]): AssertionResult {
    return specificArgumentCheck({
        check: input.check,
        expectedArguments: input.args,
        label: `${modeNoun(input.mode)} arguments`,
        match: input.match,
        record: records.at(-1) ?? null
    });
}

function unexpectedIndexedPosition(input: ArgumentCheckInput): AssertionResult {
    return input.check.fromThrowable('indexed double usage assertion', function unexpectedIndexedAssertion() {
        throw new TypeError('Indexed assertions require an index argument.');
    });
}

function positionedArgumentAssertion(input: ArgumentCheckInput, records: readonly EventRecord[]): AssertionResult {
    if (input.position === 'any') {
        return anyArgumentAssertion(input, records);
    }

    if (input.position === 'last') {
        return lastArgumentAssertion(input, records);
    }

    return input.position === 'once'
        ? onceArgumentAssertion(input, records)
        : unexpectedIndexedPosition(input);
}

function argumentAssertion(input: ArgumentCheckInput): AssertionResult {
    const inspected = inspectedDouble(input.check, input.subject);
    const prefixFailure = emptyPrefixFailure(input.check, input.match, input.args);

    if (!inspected.valid) {
        return inspected.failure;
    }

    return prefixFailure ?? positionedArgumentAssertion(input, recordsFor(inspected.history, input.mode));
}

function indexedArgumentAssertion(input: IndexedArgumentCheckInput): AssertionResult {
    const inspected = inspectedDouble(input.check, input.subject);
    const prefixFailure = emptyPrefixFailure(input.check, input.match, input.args);

    if (!inspected.valid) {
        return inspected.failure;
    }

    if (!validNonNegativeInteger(input.index)) {
        return input.check.fromThrowable('expected usage index', function expectedUsageIndex() {
            throw new TypeError('Expected usage index to be a non-negative integer.');
        });
    }

    return prefixFailure ?? specificArgumentCheck({
        check: input.check,
        expectedArguments: input.args,
        label: `${modeNoun(input.mode)} arguments`,
        match: input.match,
        record: recordsFor(inspected.history, input.mode)[input.index] ?? null
    });
}

export function argumentReference(
    name: string,
    configuration: ArgumentReferenceConfiguration
): UsageAssertionReference<AggregateArguments> {
    return defineCompositeAssertion<AggregateArguments, AssertionResult>({
        assert(check, subject: unknown, args: readonly unknown[]) {
            return argumentAssertion({ args, check, ...configuration, subject });
        },
        formatSummary() {
            return `Expected double ${modeNoun(configuration.mode)} arguments to match.`;
        },
        name
    });
}

export function argumentPrefixReference(
    name: string,
    configuration: ArgumentPrefixReferenceConfiguration
): UsageAssertionReference<AggregatePrefixArguments> {
    return defineCompositeAssertion<AggregatePrefixArguments, AssertionResult>({
        assert(check, subject: unknown, args: NonEmptyAnyArguments) {
            return argumentAssertion({ args, check, match: 'prefix', ...configuration, subject });
        },
        formatSummary() {
            return `Expected double ${modeNoun(configuration.mode)} arguments to match.`;
        },
        name
    });
}

export function indexedArgumentReference(
    name: string,
    mode: UsageMode,
    match: ArgumentMatch
): UsageAssertionReference<AggregateIndexedArguments> {
    return defineCompositeAssertion<AggregateIndexedArguments, AssertionResult>({
        assert(check, subject: unknown, index: number, args: readonly unknown[]) {
            return indexedArgumentAssertion({ args, check, index, match, mode, subject });
        },
        formatSummary() {
            return `Expected indexed double ${modeNoun(mode)} arguments to match.`;
        },
        name
    });
}

export function indexedArgumentPrefixReference(
    name: string,
    mode: UsageMode
): UsageAssertionReference<AggregateIndexedPrefixArguments> {
    return defineCompositeAssertion<AggregateIndexedPrefixArguments, AssertionResult>({
        assert(check, subject: unknown, index: number, args: NonEmptyAnyArguments) {
            return indexedArgumentAssertion({ args, check, index, match: 'prefix', mode, subject });
        },
        formatSummary() {
            return `Expected indexed double ${modeNoun(mode)} arguments to match.`;
        },
        name
    });
}
