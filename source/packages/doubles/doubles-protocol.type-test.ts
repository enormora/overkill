import { describe, expect, test } from 'tstyche';
import {
    testAsyncDisposable,
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testIterable,
    testIterator,
    type TestAsyncDisposable,
    type TestAsyncIterable,
    type TestAsyncIterator,
    type TestDisposable,
    type TestDouble,
    type TestIterable,
    type TestIterator
} from './doubles.entry-point.ts';

describe('@overkill-dev/doubles protocol doubles', function () {
    test('exports sync iterator and iterable doubles', function () {
        const iterator = testIterator.yields([ 'created' ], 1);
        const iterable = testIterable.yields([ 'created' ], 1);

        expect(iterator).type.toBe<TestIterator<string, number>>();
        expect(iterator.next).type.toBeAssignableTo<
            TestDouble<
                (...arguments_: readonly unknown[]) => IteratorResult<
                    string,
                    number
                >
            >
        >();
        expect(iterator[Symbol.iterator]()).type.toBe<IteratorObject<string, number>>();
        expect(iterable).type.toBe<TestIterable<string, number>>();
        expect(iterable[Symbol.iterator]).type.toBeAssignableTo<
            TestDouble<() => TestIterator<string, number>>
        >();
    });

    test('exports async iterator and iterable doubles', function () {
        const iterator = testAsyncIterator.yields([ 'created' ], 1);
        const iterable = testAsyncIterable.yields([ 'created' ], 1);

        expect(iterator).type.toBe<TestAsyncIterator<string, number>>();
        expect(iterator.next).type.toBeAssignableTo<
            TestDouble<(...arguments_: readonly unknown[]) => Promise<IteratorResult<string, number>>>
        >();
        expect(iterator[Symbol.asyncIterator]()).type.toBeAssignableTo<AsyncIterator<string, number, unknown>>();
        expect(iterable).type.toBe<TestAsyncIterable<string, number>>();
        expect(iterable[Symbol.asyncIterator]).type.toBeAssignableTo<
            TestDouble<() => TestAsyncIterator<string, number>>
        >();
    });

    test('exports disposable doubles', function () {
        const disposable = testDisposable();
        const asyncDisposable = testAsyncDisposable();

        expect(disposable).type.toBe<TestDisposable>();
        expect(disposable).type.toBeAssignableTo<Disposable>();
        expect(disposable.dispose).type.toBeAssignableTo<TestDouble<() => void>>();
        expect(asyncDisposable).type.toBe<TestAsyncDisposable>();
        expect(asyncDisposable).type.toBeAssignableTo<AsyncDisposable>();
        expect(asyncDisposable.asyncDispose).type.toBeAssignableTo<TestDouble<() => Promise<void>>>();
    });
});
