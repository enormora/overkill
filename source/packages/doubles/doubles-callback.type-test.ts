import { suite, test } from '@overkill-dev/test';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
import { hasKey } from '../../test-support/type-relations.ts';
import {
    rule,
    testDouble
} from './doubles.entry-point.ts';

type User = {
    readonly id: string;
    readonly name: string;
};
type ReadUser = (id: string, callback: (error: Error | null, user: User) => void) => undefined;
type MaybeReadUser = (
    id: string,
    callback?: ((error: Error | null, user: User) => void) | null
) => undefined;
type CallbackReceiver = {
    readonly scope: string;
};
type ReadScopedUser = (
    id: string,
    callback: (this: CallbackReceiver, error: Error | null, user: User) => void
) => string;

const user: User = { id: '1', name: 'Ada' };

export const testNode = suite('Double callbacks and invocation inference', [
    test('accepts callback behavior from double signatures', function (scope) {
        const callbackIndex = 1 as const;
        const receiver: CallbackReceiver = { scope: 'test' };

        scope.assert(acceptsCall, function () {
            return testDouble<ReadUser>({
                fallback: rule.callsCallback(1, [ null, user ], undefined)
            });
        });
        scope.assert(acceptsCall, function () {
            return testDouble<ReadUser>({
                fallback: rule.callsCallbackAsync(callbackIndex, [ null, user ], undefined)
            });
        });
        scope.assert(acceptsCall, function () {
            return testDouble<MaybeReadUser>({
                fallback: rule.callsCallback(1, [ null, user ], undefined)
            });
        });
        scope.assert(acceptsCall, function () {
            return testDouble<ReadScopedUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'read', receiver)
            });
        });
        scope.assert(acceptsCall, function () {
            return testDouble<(callback: (value: string) => void) => void>({
                fallback: rule.callsCallback(0, [ 'value' ], undefined)
            });
        });
        return scope.assert.collect();
    }),
    test('rejects callback behavior that does not match double signatures', function (scope) {
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ReadUser>({
                fallback: rule.callsCallback(0, [ null, user ], undefined)
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ReadUser>({
                fallback: rule.callsCallback(1, [ 'error', user ], undefined)
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ReadUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'unexpected')
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ReadScopedUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'read')
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ReadScopedUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'read', { missing: true })
            });
        });
        return scope.assert.collect();
    }),
    test('type-checks callback rule terminators and sequences', function (scope) {
        scope.assert(acceptsCall, function () {
            return testDouble<ReadUser>({
                rules: [
                    rule.when('1').callsCallback(1, [ null, user ], undefined),
                    rule.onCall(1).callsCallbackAsync(1, [ null, user ], undefined)
                ],
                fallback: rule.sequence([
                    rule.callsCallback(1, [ null, user ], undefined),
                    rule.callsCallbackAsync(1, [ null, user ], undefined)
                ])
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ReadUser>({
                rules: [ rule.when('1').callsCallback(0, [ null, user ], undefined) ]
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<ReadUser>({
                fallback: rule.sequence([
                    rule.callsCallback(1, [ null, user ], undefined),
                    rule.callsCallback(0, [ null, user ], undefined)
                ])
            });
        });
        const constructorRule = rule.whenConstructedWith('https://api.example.test');
        scope.assert(sameType.withActual<false>(), hasKey<'callsCallback'>()(constructorRule));
        scope.assert(sameType.withActual<false>(), hasKey<'callsCallbackAsync'>()(constructorRule));
        return scope.assert.collect();
    })
]);
