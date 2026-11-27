import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

export const testNode = suite('@overkill-dev/doubles callback behavior', [
    test('accepts callback behavior from double signatures', function (typeScope) {
        const callbackIndex = 1 as const;
        const receiver: CallbackReceiver = { scope: 'test' };

        typeScope.assert(acceptsCall, () =>
            testDouble<ReadUser>({
                fallback: rule.callsCallback(1, [ null, user ], undefined)
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<ReadUser>({
                fallback: rule.callsCallbackAsync(callbackIndex, [ null, user ], undefined)
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<MaybeReadUser>({
                fallback: rule.callsCallback(1, [ null, user ], undefined)
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<ReadScopedUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'read', receiver)
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<(callback: (value: string) => void) => void>({
                fallback: rule.callsCallback(0, [ 'value' ], undefined)
            }));
        return typeScope.assert.collect();
    }),
    test('rejects callback behavior that does not match double signatures', function (typeScope) {
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ReadUser>({
                fallback: rule.callsCallback(0, [ null, user ], undefined)
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ReadUser>({
                fallback: rule.callsCallback(1, [ 'error', user ], undefined)
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ReadUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'unexpected')
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ReadScopedUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'read')
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ReadScopedUser>({
                fallback: rule.callsCallback(1, [ null, user ], 'read', { missing: true })
            }));
        return typeScope.assert.collect();
    }),
    test('type-checks callback rule terminators and sequences', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<ReadUser>({
                rules: [
                    rule.when('1').callsCallback(1, [ null, user ], undefined),
                    rule.onCall(1).callsCallbackAsync(1, [ null, user ], undefined)
                ],
                fallback: rule.sequence([
                    rule.callsCallback(1, [ null, user ], undefined),
                    rule.callsCallbackAsync(1, [ null, user ], undefined)
                ])
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ReadUser>({
                rules: [ rule.when('1').callsCallback(0, [ null, user ], undefined) ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<ReadUser>({
                fallback: rule.sequence([
                    rule.callsCallback(1, [ null, user ], undefined),
                    rule.callsCallback(0, [ null, user ], undefined)
                ])
            }));
        const constructorRule = rule.whenConstructedWith('https://api.example.test');
        typeScope.assert(sameType.withActual<false>(), hasKey<'callsCallback'>()(constructorRule));
        typeScope.assert(sameType.withActual<false>(), hasKey<'callsCallbackAsync'>()(constructorRule));
        return typeScope.assert.collect();
    })
]);
