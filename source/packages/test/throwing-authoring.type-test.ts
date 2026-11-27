import type { IsEqual } from 'type-fest';
import { test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type {
    AssertAssertionFacade,
    RequireAssertionFacade,
    TestCase,
    TestDebugScope,
    TestRandom
} from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    throwingTest,
    type ThrowingTestAuthor,
    type ThrowingTestBody,
    type ThrowingTestDefinition,
    type ThrowingTestScope
} from './compatibility.entry-point.ts';

export const testNode = test('exposes throwing test authoring through the compatibility subpath', function (typeScope) {
    typeScope.assert(sameType<IsEqual<typeof throwingTest, ThrowingTestAuthor>, true>());
    typeScope.assert(sameType<IsEqual<ThrowingTestBody, (scope: ThrowingTestScope) => Promise<void> | void>, true>());
    typeScope.assert(sameType<
        IsEqual<ThrowingTestScope, {
            readonly debug: TestDebugScope;
            readonly seed: bigint;
            readonly random: TestRandom;
            readonly assert: AssertAssertionFacade;
            readonly require: RequireAssertionFacade;
            readonly signal: AbortSignal;
        }>,
        true
    >());
    typeScope.assert(assignableFrom.not<keyof ThrowingTestScope, 'plan'>());
    typeScope.assert(assignableFrom.not<keyof ThrowingTestScope['assert'], 'collect'>());
    typeScope.assert(
        sameType.withActual<true>(),
        isEqualTo<TestCase>()(throwingTest('passes', function body() {
            return undefined;
        }))
    );
    typeScope.assert(
        sameType.withActual<true>(),
        isEqualTo<TestCase>()(throwingTest({
            body() {
                return undefined;
            },
            controls: { timeoutMilliseconds: 50 },
            title: 'passes'
        }))
    );
    typeScope.assert(sameType<
        [{
            readonly body: ThrowingTestBody;
            readonly title: string;
        }] extends [ThrowingTestDefinition] ? true : false,
        true
    >());
    typeScope.assert(acceptsCall, () =>
        throwingTest({
            body() {
                return undefined;
            },
            controls: { capture: 'live' },
            title: 'captures'
        }));
    return typeScope.assert.collect();
});
