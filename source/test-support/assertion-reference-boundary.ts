import type {
    CompositeAssertionReference as PublishedCompositeReference,
    CompositeAssertionReturn as PublishedCompositeReturn,
    NarrowingCompositeAssertionReference as PublishedNarrowingReference
} from '@overkill-dev/test/assert';
import {
    getAssertionReferenceRecord,
    isAssertionReference,
    isNarrowingAssertionReference,
    type CompositeAssertionReference as EngineCompositeReference,
    type CompositeAssertionReturn as EngineCompositeReturn,
    type NarrowingCompositeAssertionReference as EngineNarrowingReference
} from '../assertion-protocol/assertion-reference.ts';

type PublishedResult = Promise<PublishedCompositeReturn<'assert'>> | PublishedCompositeReturn<'assert'>;
type EngineResult = EngineCompositeReturn<'assert'> | Promise<EngineCompositeReturn<'assert'>>;
type ResultForEngine<Result> = Result extends PromiseLike<unknown> ? Promise<EngineCompositeReturn<'assert'>>
    : EngineCompositeReturn<'assert'>;
type ResultForPublished<Result> = Result extends PromiseLike<unknown> ? Promise<PublishedCompositeReturn<'assert'>>
    : PublishedCompositeReturn<'assert'>;

type CompatibleCompositeReference<
    Arguments extends readonly unknown[],
    EngineReturn extends EngineResult,
    PublishedReturn extends PublishedResult
> = EngineCompositeReference<Arguments, EngineReturn> & PublishedCompositeReference<Arguments, PublishedReturn>;

type CompatibleNarrowingReference<
    Actual,
    Narrowed extends Actual,
    Arguments extends readonly unknown[]
> = EngineNarrowingReference<Actual, Narrowed, Arguments> & PublishedNarrowingReference<Actual, Narrowed, Arguments>;

export function requireEngineCompositeReference<Arguments extends readonly unknown[], Result extends PublishedResult>(
    reference: PublishedCompositeReference<Arguments, Result>
): asserts reference is CompatibleCompositeReference<Arguments, ResultForEngine<Result>, Result> {
    if (!isAssertionReference(reference) || isNarrowingAssertionReference(reference)) {
        throw new TypeError('Expected a composite reference accepted by the engine under test.');
    }
    const record = getAssertionReferenceRecord(reference);
    if (record.kind !== 'composite' || typeof record.run !== 'function' || typeof record.name !== 'string') {
        throw new TypeError('Expected an executable composite reference.');
    }
}

export function requirePublishedCompositeReference<Arguments extends readonly unknown[], Result extends EngineResult>(
    reference: EngineCompositeReference<Arguments, Result>
): asserts reference is CompatibleCompositeReference<Arguments, Result, ResultForPublished<Result>> {
    if (!isAssertionReference(reference) || isNarrowingAssertionReference(reference)) {
        throw new TypeError('Expected a composite reference returned by the subject.');
    }
    const record = getAssertionReferenceRecord(reference);
    if (record.kind !== 'composite' || typeof record.run !== 'function' || typeof record.name !== 'string') {
        throw new TypeError('Expected an executable composite reference.');
    }
}

export function requireEngineNarrowingReference<Actual, Narrowed extends Actual, Arguments extends readonly unknown[]>(
    reference: PublishedNarrowingReference<Actual, Narrowed, Arguments>
): asserts reference is CompatibleNarrowingReference<Actual, Narrowed, Arguments> {
    if (!isNarrowingAssertionReference(reference)) {
        throw new TypeError('Expected a narrowing reference accepted by the engine under test.');
    }
    const record = getAssertionReferenceRecord(reference);
    if (record.kind !== 'narrowing-composite' || typeof record.narrows !== 'function') {
        throw new TypeError('Expected an executable narrowing reference.');
    }
}

export function subjectAssertion<Arguments extends readonly unknown[], Result extends EngineResult>(
    reference: EngineCompositeReference<Arguments, Result>
): PublishedCompositeReference<Arguments, ResultForPublished<Result>> {
    requirePublishedCompositeReference(reference);
    return reference;
}
