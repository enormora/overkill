import { describe, expect, test } from 'tstyche';
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

describe('./assert.entry-point.ts', function () {
    test('exports typed composite assertion references', function () {
        expect(syncAssertion).type.toBe<CompositeAssertionReference<[value: boolean], TrueCompositeChild>>();
        expect(asyncAssertion).type.toBe<CompositeAssertionReference<[value: boolean], Promise<TrueCompositeChild>>>();
        expect<AssertReferenceArguments<typeof syncAssertion>>().type.toBe<readonly [value: boolean]>();
        expect<AssertReferenceReturn<typeof syncAssertion>>().type.toBe<SyncAssertionReturn>();
        expect<AssertReferenceReturn<typeof asyncAssertion>>().type.toBe<Promise<void>>();
    });

    test('exports typed narrowing assertion references', function () {
        const value: unknown = null;

        expect(narrowingAssertion).type.toBe<NarrowingCompositeAssertionReference<unknown, string, readonly []>>();
        expect<AssertReferenceReturn<typeof narrowingAssertion>>().type.toBe<SyncAssertionReturn>();
        assertFacade(narrowingAssertion, value);
        requireFacade(narrowingAssertion, value);
        expect(value).type.toBe<string>();
    });

    test('exposes composite check methods only as an injected builder type', function () {
        expect(check.fromThrowable).type.toBeCallableWith('foreign', function assertForeign() {
            return undefined;
        });
        expect(check.fromRejectable).type.toBeCallableWith('foreign', async function assertForeign() {
            await Promise.resolve();
        });
        expect(check.group).type.toBeCallableWith([ check.true(true) ]);
        expect(check.deepEqual).type.toBeCallableWith({ id: 1 }, { id: 1 });
        expect(check.deepEqual).type.not.toBeCallableWith(1, 1);
    });
});
