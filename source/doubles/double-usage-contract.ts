import type {
    CompositeCheckBuilder
} from '../assert/assertion-extension.ts';
import type {
    CompositeAssertionReference,
    CompositeAssertionReturn
} from '../assertion-protocol/assertion-reference.ts';
import type {
    CompositeAssertionChildNode
} from '../assertion-protocol/assertion-node.ts';

export type UsageMode = 'call' | 'construction' | 'interaction';
export type ArgumentMatch = 'exact' | 'partial' | 'prefix';
export type AssertionCheck = CompositeCheckBuilder<'assert'>;
export type AssertionChild = CompositeAssertionChildNode<'assert'>;
export type AssertionGroupItem = Parameters<AssertionCheck['group']>[0][number];
export type AssertionResult = CompositeAssertionReturn<'assert'>;
export type UsageAssertionReference<Arguments extends readonly unknown[]> = CompositeAssertionReference<
    Arguments,
    AssertionResult
>;

type DoubleList = readonly [unknown, unknown, ...unknown[]];
type AnyArguments = readonly unknown[];
type NonEmptyAnyArguments = readonly [unknown, ...unknown[]];

export type CountArguments = readonly [double: unknown, expectedCount: number];
export type ValueArguments = readonly [double: unknown];
export type OrderArguments = readonly [doubles: DoubleList];
export type AggregateArguments = readonly [double: unknown, args: AnyArguments];
export type AggregatePrefixArguments = readonly [double: unknown, args: NonEmptyAnyArguments];
export type AggregateIndexedArguments = readonly [double: unknown, index: number, args: AnyArguments];
export type AggregateIndexedPrefixArguments = readonly [
    double: unknown,
    index: number,
    args: NonEmptyAnyArguments
];

export function modeNoun(mode: UsageMode): string {
    if (mode === 'call') {
        return 'call';
    }

    return mode === 'construction' ? 'construction' : 'interaction';
}

export function groupChildren(
    check: AssertionCheck,
    children: readonly AssertionGroupItem[],
    passingLabel: string
): AssertionResult {
    const [ first, ...rest ] = children;

    return first === undefined ? check.annotated(passingLabel).true(true) : check.group([ first, ...rest ]);
}
