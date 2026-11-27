import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

export const testNode = suite('@overkill-dev/doubles protocol doubles', [
    test('exports sync iterator and iterable doubles', function (typeScope) {
        const iterator = testIterator.yields([ 'created' ], 1);
        const iterable = testIterable.yields([ 'created' ], 1);

        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestIterator<string, number>>()(iterator));
        typeScope.assert(
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
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<IteratorObject<string, number>>()(iterator[Symbol.iterator]())
        );
        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestIterable<string, number>>()(iterable));
        typeScope.assert(
            sameType.withActual<true>(),
            isAssignableTo<TestDouble<() => TestIterator<string, number>>>()(iterable[Symbol.iterator])
        );
        return typeScope.assert.collect();
    }),
    test('exports async iterator and iterable doubles', function (typeScope) {
        const iterator = testAsyncIterator.yields([ 'created' ], 1);
        const iterable = testAsyncIterable.yields([ 'created' ], 1);

        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestAsyncIterator<string, number>>()(iterator));
        typeScope.assert(
            sameType.withActual<true>(),
            isAssignableTo<
                TestDouble<(...arguments_: readonly unknown[]) => Promise<IteratorResult<string, number>>>
            >()(iterator.next)
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isAssignableTo<AsyncIterator<string, number, unknown>>()(iterator[Symbol.asyncIterator]())
        );
        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestAsyncIterable<string, number>>()(iterable));
        typeScope.assert(
            sameType.withActual<true>(),
            isAssignableTo<TestDouble<() => TestAsyncIterator<string, number>>>()(iterable[Symbol.asyncIterator])
        );
        return typeScope.assert.collect();
    }),
    test('exports disposable doubles', function (typeScope) {
        const disposable = testDisposable();
        const asyncDisposable = testAsyncDisposable();

        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestDisposable>()(disposable));
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<Disposable>()(disposable));
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<TestDouble<() => void>>()(disposable.dispose));
        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestAsyncDisposable>()(asyncDisposable));
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<AsyncDisposable>()(asyncDisposable));
        typeScope.assert(
            sameType.withActual<true>(),
            isAssignableTo<TestDouble<() => Promise<void>>>()(asyncDisposable.asyncDispose)
        );
        return typeScope.assert.collect();
    })
]);
