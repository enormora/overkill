import { suite, test } from '@overkill-dev/test';
import { assignableTo, sameType } from '@overkill-dev/type-test';
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

export const testNode = suite('@overkill-dev/doubles protocol doubles', [
    test('exports sync iterator and iterable doubles', function (typeScope) {
        const iterator = testIterator.yields([ 'created' ], 1);
        const iterable = testIterable.yields([ 'created' ], 1);

        typeScope.assert(sameType.withActual<TestIterator<string, number>>(), iterator);
        typeScope.assert(
            assignableTo.withActual<
                TestDouble<
                    (...arguments_: readonly unknown[]) => IteratorResult<
                        string,
                        number
                    >
                >
            >(),
            iterator.next
        );
        typeScope.assert(sameType.withActual<IteratorObject<string, number>>(), iterator[Symbol.iterator]());
        typeScope.assert(sameType.withActual<TestIterable<string, number>>(), iterable);
        typeScope.assert(
            assignableTo.withActual<TestDouble<() => TestIterator<string, number>>>(),
            iterable[Symbol.iterator]
        );
        return typeScope.assert.collect();
    }),
    test('exports async iterator and iterable doubles', function (typeScope) {
        const iterator = testAsyncIterator.yields([ 'created' ], 1);
        const iterable = testAsyncIterable.yields([ 'created' ], 1);

        typeScope.assert(sameType.withActual<TestAsyncIterator<string, number>>(), iterator);
        typeScope.assert(
            assignableTo.withActual<
                TestDouble<(...arguments_: readonly unknown[]) => Promise<IteratorResult<string, number>>>
            >(),
            iterator.next
        );
        typeScope.assert(
            assignableTo.withActual<AsyncIterator<string, number, unknown>>(),
            iterator[Symbol.asyncIterator]()
        );
        typeScope.assert(sameType.withActual<TestAsyncIterable<string, number>>(), iterable);
        typeScope.assert(
            assignableTo.withActual<TestDouble<() => TestAsyncIterator<string, number>>>(),
            iterable[Symbol.asyncIterator]
        );
        return typeScope.assert.collect();
    }),
    test('exports disposable doubles', function (typeScope) {
        const disposable = testDisposable();
        const asyncDisposable = testAsyncDisposable();

        typeScope.assert(sameType.withActual<TestDisposable>(), disposable);
        typeScope.assert(assignableTo.withActual<Disposable>(), disposable);
        typeScope.assert(assignableTo.withActual<TestDouble<() => void>>(), disposable.dispose);
        typeScope.assert(sameType.withActual<TestAsyncDisposable>(), asyncDisposable);
        typeScope.assert(assignableTo.withActual<AsyncDisposable>(), asyncDisposable);
        typeScope.assert(assignableTo.withActual<TestDouble<() => Promise<void>>>(), asyncDisposable.asyncDispose);
        return typeScope.assert.collect();
    })
]);
