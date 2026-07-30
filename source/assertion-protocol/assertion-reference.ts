import type {
    CompositeAssertionChildNode
} from './assertion-node.ts';
import type {
    AssertionSource,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from './assertion-node-shape.ts';

const assertionReferenceIdentity: unique symbol = Symbol('OverkillAssertionReference');
const assertionReferenceRecordIdentity: unique symbol = Symbol('OverkillAssertionReferenceRecord');
const compositeGroupIdentity: unique symbol = Symbol('OverkillCompositeGroup');

export type CompositeAssertionSummaryContext = {
    readonly name: string;
    readonly source: AssertionSource;
};

export type CompositeAssertionGroup<Source extends AssertionSource = AssertionSource> = {
    readonly [compositeGroupIdentity]: true;
    readonly children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>;
};

type CompositeAssertionReturnByKind<Source extends AssertionSource> = {
    readonly child: CompositeAssertionChildNode<Source>;
    readonly group: CompositeAssertionGroup<Source>;
};

export type CompositeAssertionReturn<Source extends AssertionSource = AssertionSource> = CompositeAssertionReturnByKind<
    Source
>[keyof CompositeAssertionReturnByKind<Source>];

type PromiseCompositeAssertionReturn = Promise<CompositeAssertionReturn<'assert'>>;

export type AssertCompositeAssertionReturn = CompositeAssertionReturn<'assert'> | PromiseCompositeAssertionReturn;

type SyncAssertionReturn = ReturnType<() => void>;

export type CompositeAssertionSummaryFormatter<Arguments extends readonly unknown[]> = (
    context: CompositeAssertionSummaryContext,
    ...parameters: Arguments
) => string;

export type NarrowingCompositeAssertionSummaryFormatter<Actual, Arguments extends readonly unknown[]> = (
    context: CompositeAssertionSummaryContext,
    actual: Actual,
    ...parameters: Arguments
) => string;

export type CompositeAssertionRunnerInput<
    Arguments extends readonly unknown[],
    Source extends AssertionSource
> = {
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly parameters: Arguments;
    readonly source: Source;
};

export type CompositeAssertionReferenceRecord<
    Arguments extends readonly unknown[] = readonly unknown[],
    Result extends AssertCompositeAssertionReturn = AssertCompositeAssertionReturn
> = {
    readonly formatSummary: CompositeAssertionSummaryFormatter<Arguments> | null;
    readonly kind: 'composite';
    readonly name: string;
    readonly run: (input: CompositeAssertionRunnerInput<Arguments, 'assert'>) => Result;
};

export type NarrowingCompositeAssertionReferenceRecord<
    Actual = unknown,
    Narrowed extends Actual = Actual,
    Arguments extends readonly unknown[] = readonly unknown[]
> = {
    readonly formatSummary: NarrowingCompositeAssertionSummaryFormatter<Actual, Arguments> | null;
    readonly kind: 'narrowing-composite';
    readonly name: string;
    readonly narrows: (actual: Actual, ...parameters: Arguments) => actual is Narrowed;
};

export type AssertionReferenceRecord = CompositeAssertionReferenceRecord | NarrowingCompositeAssertionReferenceRecord;

export type CompositeAssertionReference<
    Arguments extends readonly unknown[] = readonly unknown[],
    Result extends AssertCompositeAssertionReturn = AssertCompositeAssertionReturn
> = {
    readonly [assertionReferenceIdentity]: true;
    readonly [assertionReferenceRecordIdentity]: CompositeAssertionReferenceRecord<Arguments, Result>;
};

export type NarrowingCompositeAssertionReference<
    Actual = unknown,
    Narrowed extends Actual = Actual,
    Arguments extends readonly unknown[] = readonly unknown[]
> = {
    readonly [assertionReferenceIdentity]: true;
    readonly [assertionReferenceRecordIdentity]: NarrowingCompositeAssertionReferenceRecord<
        Actual,
        Narrowed,
        Arguments
    >;
};

export type AssertionReference = CompositeAssertionReference | NarrowingCompositeAssertionReference;

type NamedAssertionReferenceRecord = {
    readonly name: string;
};

type BrandedAssertionReference<Record extends NamedAssertionReferenceRecord> = {
    readonly [assertionReferenceIdentity]: true;
    readonly [assertionReferenceRecordIdentity]: Readonly<Record>;
};

type NarrowingReferenceArguments<Actual, Arguments extends readonly unknown[]> = readonly [
    actual: Actual,
    ...parameters: Arguments
];

type ReferenceArguments<Reference> = Reference extends NarrowingCompositeAssertionReference<
    infer Actual,
    infer Narrowed,
    infer Arguments
> ? NarrowingReferenceArguments<Actual | Narrowed, Arguments>
    : never;

type ReferenceReturn<Result> = Result extends Promise<CompositeAssertionReturn<'assert'>> ? Promise<void>
    : SyncAssertionReturn;

type ReadonlyParameters<Arguments extends readonly unknown[]> = readonly [...Arguments];

export type AssertReferenceArguments<Reference> = Reference extends CompositeAssertionReference<infer Arguments>
    ? ReadonlyParameters<Arguments>
    : ReferenceArguments<Reference>;

export type AssertReferenceReturn<Reference> = Reference extends CompositeAssertionReference<
    infer Arguments,
    infer Result
> ? Arguments extends readonly unknown[] ? ReferenceReturn<Result> : never
    : SyncAssertionReturn;

function ensureAssertionName(name: string): void {
    if (name.trim().length === 0) {
        throw new TypeError('Assertion reference name must not be empty.');
    }
}

function createAssertionReference<Record extends NamedAssertionReferenceRecord>(
    record: Record
): BrandedAssertionReference<Record> {
    ensureAssertionName(record.name);

    return {
        [assertionReferenceIdentity]: true,
        [assertionReferenceRecordIdentity]: record
    };
}

export const createCompositeAssertionReferenceRecord: <
    Arguments extends readonly unknown[],
    Result extends AssertCompositeAssertionReturn
>(record: CompositeAssertionReferenceRecord<Arguments, Result>) => CompositeAssertionReference<Arguments, Result> =
    createAssertionReference;

export const createNarrowingCompositeAssertionReferenceRecord: <
    Actual,
    Narrowed extends Actual,
    Arguments extends readonly unknown[]
>(
    record: NarrowingCompositeAssertionReferenceRecord<Actual, Narrowed, Arguments>
) => NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments> = createAssertionReference;

export function getAssertionReferenceRecord(reference: AssertionReference): AssertionReferenceRecord {
    return reference[assertionReferenceRecordIdentity];
}

export function getCompositeAssertionReferenceRecord<
    Arguments extends readonly unknown[],
    Result extends AssertCompositeAssertionReturn
>(
    reference: CompositeAssertionReference<Arguments, Result>
): CompositeAssertionReferenceRecord<Arguments, Result> {
    return reference[assertionReferenceRecordIdentity];
}

export function getNarrowingAssertionReferenceRecord<
    Actual,
    Narrowed extends Actual,
    Arguments extends readonly unknown[]
>(
    reference: NarrowingCompositeAssertionReference<Actual, Narrowed, Arguments>
): NarrowingCompositeAssertionReferenceRecord<Actual, Narrowed, Arguments> {
    return reference[assertionReferenceRecordIdentity];
}

export function isAssertionReference(value: unknown): value is AssertionReference {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, assertionReferenceIdentity);
}

export function isNarrowingAssertionReference(value: unknown): value is NarrowingCompositeAssertionReference {
    return isAssertionReference(value) && getAssertionReferenceRecord(value).kind === 'narrowing-composite';
}

export function isCompositeAssertionGroup<Source extends AssertionSource>(
    value: unknown
): value is CompositeAssertionGroup<Source> {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, compositeGroupIdentity);
}

export function createCompositeAssertionGroup<Source extends AssertionSource>(
    children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>
): CompositeAssertionGroup<Source> {
    return { [compositeGroupIdentity]: true, children };
}
