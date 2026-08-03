import { describe, expect, test } from 'tstyche';
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

describe('@overkill-dev/doubles callback behavior', function () {
    test('accepts callback behavior from double signatures', function () {
        const callbackIndex = 1 as const;
        const receiver: CallbackReceiver = { scope: 'test' };

        expect(testDouble<ReadUser>).type.toBeCallableWith({
            fallback: rule.callsCallback(1, [ null, user ], undefined)
        });
        expect(testDouble<ReadUser>).type.toBeCallableWith({
            fallback: rule.callsCallbackAsync(callbackIndex, [ null, user ], undefined)
        });
        expect(testDouble<MaybeReadUser>).type.toBeCallableWith({
            fallback: rule.callsCallback(1, [ null, user ], undefined)
        });
        expect(testDouble<ReadScopedUser>).type.toBeCallableWith({
            fallback: rule.callsCallback(1, [ null, user ], 'read', receiver)
        });
        expect(testDouble).type.toBeCallableWith({
            fallback: rule.callsCallback(0, [ 'value' ], undefined)
        });
    });

    test('rejects callback behavior that does not match double signatures', function () {
        expect(testDouble<ReadUser>).type.not.toBeCallableWith({
            fallback: rule.callsCallback(0, [ null, user ], undefined)
        });
        expect(testDouble<ReadUser>).type.not.toBeCallableWith({
            fallback: rule.callsCallback(1, [ 'error', user ], undefined)
        });
        expect(testDouble<ReadUser>).type.not.toBeCallableWith({
            fallback: rule.callsCallback(1, [ null, user ], 'unexpected')
        });
        expect(testDouble<ReadScopedUser>).type.not.toBeCallableWith({
            fallback: rule.callsCallback(1, [ null, user ], 'read')
        });
        expect(testDouble<ReadScopedUser>).type.not.toBeCallableWith({
            fallback: rule.callsCallback(1, [ null, user ], 'read', { missing: true })
        });
    });

    test('type-checks callback rule terminators and sequences', function () {
        expect(testDouble<ReadUser>).type.toBeCallableWith({
            rules: [
                rule.when('1').callsCallback(1, [ null, user ], undefined),
                rule.onCall(1).callsCallbackAsync(1, [ null, user ], undefined)
            ],
            fallback: rule.sequence([
                rule.callsCallback(1, [ null, user ], undefined),
                rule.callsCallbackAsync(1, [ null, user ], undefined)
            ])
        });
        expect(testDouble<ReadUser>).type.not.toBeCallableWith({
            rules: [ rule.when('1').callsCallback(0, [ null, user ], undefined) ]
        });
        expect(testDouble<ReadUser>).type.not.toBeCallableWith({
            fallback: rule.sequence([
                rule.callsCallback(1, [ null, user ], undefined),
                rule.callsCallback(0, [ null, user ], undefined)
            ])
        });
        expect(rule.whenConstructedWith('https://api.example.test')).type.not.toHaveProperty('callsCallback');
        expect(rule.whenConstructedWith('https://api.example.test')).type.not.toHaveProperty('callsCallbackAsync');
    });
});
