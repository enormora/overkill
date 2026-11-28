import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
import type { AssertAssertionFacade, RequireAssertionFacade } from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion,
    type AssertReferenceArguments,
    type AssertReferenceReturn,
    type CompositeAssertionReference,
    type CompositeCheckBuilder,
    type NarrowingCompositeAssertionReference
} from './assert.entry-point.ts';

type SyncAssertionReturn = ReturnType<() => void>;
type TrueCompositeChild = ReturnType<CompositeCheckBuilder<'assert'>['true']>;

const syncAssertion = defineCompositeAssertion({
    assert(check, value: boolean) {
        return check.true(value);
    },
    name: 'syncAssertion'
});

const asyncAssertion = defineCompositeAssertion({
    async assert(check, value: boolean) {
        await Promise.resolve();
        return check.true(value);
    },
    name: 'asyncAssertion'
});

const narrowingAssertion = defineNarrowingCompositeAssertion({
    name: 'narrowingAssertion',
    narrows(value: unknown): value is string {
        return typeof value === 'string';
    }
});

declare const assertFacade: AssertAssertionFacade;
declare const requireFacade: RequireAssertionFacade;
declare const check: CompositeCheckBuilder<'assert'>;

export const testNode = suite('Composite and narrowing assertions', [
    test('exports typed composite assertion references', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<CompositeAssertionReference<[value: boolean], TrueCompositeChild>>()(syncAssertion)
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<CompositeAssertionReference<[value: boolean], Promise<TrueCompositeChild>>>()(asyncAssertion)
        );
        scope.assert(
            sameType<IsEqual<AssertReferenceArguments<typeof syncAssertion>, readonly [value: boolean]>, true>()
        );
        scope.assert(sameType<IsEqual<AssertReferenceReturn<typeof syncAssertion>, SyncAssertionReturn>, true>());
        scope.assert(sameType<IsEqual<AssertReferenceReturn<typeof asyncAssertion>, Promise<void>>, true>());
        return scope.assert.collect();
    }),
    test('exports typed narrowing assertion references', function (scope) {
        const value: unknown = null;

        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<NarrowingCompositeAssertionReference<unknown, string, readonly []>>()(narrowingAssertion)
        );
        scope.assert(
            sameType<IsEqual<AssertReferenceReturn<typeof narrowingAssertion>, SyncAssertionReturn>, true>()
        );
        assertFacade(narrowingAssertion, value);
        requireFacade(narrowingAssertion, value);
        scope.assert(sameType.withActual<string>(), value);
        return scope.assert.collect();
    }),
    test('exposes composite check methods only as an injected builder type', function (scope) {
        scope.assert(acceptsCall, function () {
            return check.fromThrowable('foreign', function assertForeign() {
                return undefined;
            });
        });
        scope.assert(acceptsCall, async function () {
            return check.fromRejectable('foreign', async function assertForeign() {
                await Promise.resolve();
            });
        });
        scope.assert(acceptsCall, function () {
            return check.group([ check.true(true) ]);
        });
        scope.assert(acceptsCall, function () {
            return check.deepEqual({ id: 1 }, { id: 1 });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return check.deepEqual(1, 1);
        });
        return scope.assert.collect();
    })
]);
