export type {
    AssertCompositeAssertionReturn,
    AssertionReference,
    AssertionReferenceRecord,
    AssertReferenceArguments,
    AssertReferenceReturn,
    CompositeAssertionGroup,
    CompositeAssertionReference,
    CompositeAssertionReferenceRecord,
    CompositeAssertionReturn,
    CompositeAssertionRunnerInput,
    CompositeAssertionSummaryContext,
    CompositeAssertionSummaryFormatter,
    NarrowingCompositeAssertionReference,
    NarrowingCompositeAssertionReferenceRecord,
    NarrowingCompositeAssertionSummaryFormatter
} from '../../assertion-protocol/assertion-reference.ts';
export {
    createCompositeAssertionGroup,
    createCompositeAssertionReferenceRecord,
    createNarrowingCompositeAssertionReferenceRecord,
    getAssertionReferenceRecord,
    getCompositeAssertionReferenceRecord,
    getNarrowingAssertionReferenceRecord,
    isAssertionReference,
    isCompositeAssertionGroup,
    isNarrowingAssertionReference
} from '../../assertion-protocol/assertion-reference.ts';
export type {
    AssertAssertionNode,
    BuiltInAssertAssertionNode,
    CompositeAssertionChildNode,
    CompositeAssertionNode,
    ForeignAssertionNode,
    ForeignAssertionResult,
    RequireAssertionNode
} from '../../assertion-protocol/assertion-node.ts';
export type {
    AssertionOptions,
    AssertionSource,
    DeepComparable,
    FailedCheck,
    FailedCompositeCheck,
    FailedForeignCheck,
    FailedLeafCheck,
    InstanceConstructor,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation,
    SourceLocation,
    SourceLocationProvider
} from '../../assertion-protocol/assertion-node-shape.ts';
export type {
    ErrorMatcher,
    ExactThrownMatcher,
    SynchronousCallback,
    ThrownAssertionObservation,
    ThrownMatcher
} from '../../assertion-protocol/thrown-matcher.ts';
export { thrownMatcherChildren } from '../../assertion-protocol/thrown-matcher.ts';
export type { ThrownErrorRecord } from '../../assertion-protocol/thrown-error-record.ts';
export { createThrownErrorRecord } from '../../assertion-protocol/thrown-error-record.ts';
