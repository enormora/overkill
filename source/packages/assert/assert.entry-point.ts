export {
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion
} from '../../assert/assertion-extension.ts';
export type {
    CompositeAssertionDefinition,
    CompositeCheckBuilder,
    NarrowingCompositeAssertionDefinition
} from '../../assert/assertion-extension.ts';
export type {
    AssertReferenceArguments,
    AssertReferenceReturn,
    CompositeAssertionGroup,
    CompositeAssertionReference,
    CompositeAssertionReturn,
    CompositeAssertionSummaryContext,
    NarrowingCompositeAssertionReference
} from '../engine/assertion-protocol.entry-point.ts';
export type {
    AssertionSource,
    DeepComparable,
    ErrorMatcher,
    ExactThrownMatcher,
    NonEmptyReadonlyArray,
    SynchronousCallback,
    ThrownMatcher
} from '../engine/assertion-protocol.entry-point.ts';
