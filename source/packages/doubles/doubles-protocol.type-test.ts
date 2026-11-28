import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import { isEqualTo, isAssignableTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Protocol doubles and member inference', [
    test('exports sync iterator and iterable doubles', function (scope) {
        const iterator = testIterator.yields([ 'created' ], 1);
        const iterable = testIterable.yields([ 'created' ], 1);

        scope.assert(sameType.withActual<true>(), isEqualTo<TestIterator<string, number>>()(iterator));
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<
                TestDouble<
                    (...arguments_: readonly unknown[]) => IteratorResult<
                        string,
                        number
                    >
                >
            >()(iterator.next)
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<IteratorObject<string, number>>()(iterator[Symbol.iterator]())
        );
        scope.assert(sameType.withActual<true>(), isEqualTo<TestIterable<string, number>>()(iterable));
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<TestDouble<() => TestIterator<string, number>>>()(iterable[Symbol.iterator])
        );
        return scope.assert.collect();
    }),
    test('exports async iterator and iterable doubles', function (scope) {
        const iterator = testAsyncIterator.yields([ 'created' ], 1);
        const iterable = testAsyncIterable.yields([ 'created' ], 1);

        scope.assert(sameType.withActual<true>(), isEqualTo<TestAsyncIterator<string, number>>()(iterator));
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<
                TestDouble<(...arguments_: readonly unknown[]) => Promise<IteratorResult<string, number>>>
            >()(iterator.next)
        );
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<AsyncIterator<string, number, unknown>>()(iterator[Symbol.asyncIterator]())
        );
        scope.assert(sameType.withActual<true>(), isEqualTo<TestAsyncIterable<string, number>>()(iterable));
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<TestDouble<() => TestAsyncIterator<string, number>>>()(iterable[Symbol.asyncIterator])
        );
        return scope.assert.collect();
    }),
    test('exports disposable doubles', function (scope) {
        const disposable = testDisposable();
        const asyncDisposable = testAsyncDisposable();

        scope.assert(sameType.withActual<true>(), isEqualTo<TestDisposable>()(disposable));
        scope.assert(sameType.withActual<true>(), isAssignableTo<Disposable>()(disposable));
        scope.assert(sameType.withActual<true>(), isAssignableTo<TestDouble<() => void>>()(disposable.dispose));
        scope.assert(sameType.withActual<true>(), isEqualTo<TestAsyncDisposable>()(asyncDisposable));
        scope.assert(sameType.withActual<true>(), isAssignableTo<AsyncDisposable>()(asyncDisposable));
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<TestDouble<() => Promise<void>>>()(asyncDisposable.asyncDispose)
        );
        return scope.assert.collect();
    })
]);
