import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { AssertAssertionFacade, RequireAssertionFacade } from '../engine/engine.entry-point.ts';
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

export const testNode = suite('./assert.entry-point.ts', [
    test('exports typed composite assertion references', function (typeScope) {
        typeScope.assert(
            sameType.withActual<CompositeAssertionReference<[value: boolean], TrueCompositeChild>>(),
            syncAssertion
        );
        typeScope.assert(
            sameType.withActual<CompositeAssertionReference<[value: boolean], Promise<TrueCompositeChild>>>(),
            asyncAssertion
        );
        typeScope.assert(sameType<AssertReferenceArguments<typeof syncAssertion>, readonly [value: boolean]>());
        typeScope.assert(sameType<AssertReferenceReturn<typeof syncAssertion>, SyncAssertionReturn>());
        typeScope.assert(sameType<AssertReferenceReturn<typeof asyncAssertion>, Promise<void>>());
        return typeScope.assert.collect();
    }),
    test('exports typed narrowing assertion references', function (typeScope) {
        const value: unknown = null;

        typeScope.assert(
            sameType.withActual<NarrowingCompositeAssertionReference<unknown, string, readonly []>>(),
            narrowingAssertion
        );
        typeScope.assert(sameType<AssertReferenceReturn<typeof narrowingAssertion>, SyncAssertionReturn>());
        assertFacade(narrowingAssertion, value);
        requireFacade(narrowingAssertion, value);
        typeScope.assert(sameType.withActual<string>(), value);
        return typeScope.assert.collect();
    }),
    test('exposes composite check methods only as an injected builder type', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            check.fromThrowable('foreign', function assertForeign() {
                return undefined;
            }));
        typeScope.assert(acceptsCall, async () =>
            check.fromRejectable('foreign', async function assertForeign() {
                await Promise.resolve();
            }));
        typeScope.assert(acceptsCall, () => check.group([ check.true(true) ]));
        typeScope.assert(acceptsCall, () => check.deepEqual({ id: 1 }, { id: 1 }));
        typeScope.assert(rejectsCall('argument-type'), () => check.deepEqual(1, 1));
        return typeScope.assert.collect();
    })
]);
