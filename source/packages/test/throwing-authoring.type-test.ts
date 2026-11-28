import type { IsEqual } from 'type-fest';
import { acceptsCall, assignableFrom, sameType } from '../type-test/type-test.entry-point.ts';
import type {
    AssertAssertionFacade,
    RequireAssertionFacade,
    TestCase,
    TestDebugScope,
    TestRandom
} from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { test } from './test.entry-point.ts';
import {
    throwingTest,
    type ThrowingTestAuthor,
    type ThrowingTestBody,
    type ThrowingTestDefinition,
    type ThrowingTestScope
} from './compatibility.entry-point.ts';

export const testNode = test('exposes throwing test authoring through the compatibility subpath', function (scope) {
    scope.assert(sameType<IsEqual<typeof throwingTest, ThrowingTestAuthor>, true>());
    scope.assert(sameType<IsEqual<ThrowingTestBody, (scope: ThrowingTestScope) => Promise<void> | void>, true>());
    scope.assert(sameType<
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
    scope.assert(assignableFrom.not<keyof ThrowingTestScope, 'plan'>());
    scope.assert(assignableFrom.not<keyof ThrowingTestScope['assert'], 'collect'>());
    scope.assert(
        sameType.withActual<true>(),
        isEqualTo<TestCase>()(throwingTest('passes', function body() {
            return undefined;
        }))
    );
    scope.assert(
        sameType.withActual<true>(),
        isEqualTo<TestCase>()(throwingTest({
            body() {
                return undefined;
            },
            controls: { timeoutMilliseconds: 50 },
            title: 'passes'
        }))
    );
    scope.assert(sameType<
        [{
            readonly body: ThrowingTestBody;
            readonly title: string;
        }] extends [ThrowingTestDefinition] ? true : false,
        true
    >());
    scope.assert(acceptsCall, function () {
        return throwingTest({
            body() {
                return undefined;
            },
            controls: { capture: 'live' },
            title: 'captures'
        });
    });
    return scope.assert.collect();
});
