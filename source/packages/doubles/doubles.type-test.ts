import { describe, expect, test } from 'tstyche';
import {
    testDouble,
    type TestDouble
} from './doubles.entry-point.ts';

type User = {
    readonly id: string;
    readonly name: string;
};

type Client = {
    readonly baseUrl: string;
};

type LoadUser = (id: string, includeDeleted: boolean) => User;
type SaveUser = (user: User) => Promise<User>;
type ClientConstructor = new (baseUrl: string) => Client;

const user: User = { id: '1', name: 'Ada' };
const client: Client = { baseUrl: 'https://api.example.test' };

describe('@overkill-dev/doubles', function () {
    test('creates an untyped default double', function () {
        const value = testDouble();

        expect(value).type.toBe<(...arguments_: readonly unknown[]) => unknown>();
        expect(value('id')).type.toBe<unknown>();
    });

    test('creates fixed-return doubles', function () {
        const untyped = testDouble.returns(user);
        const typed = testDouble.returns<LoadUser>(user);
        const voidCallback = testDouble.returns<() => void>();

        expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => User>();
        expect(typed).type.toBe<TestDouble<LoadUser>>();
        expect(typed).type.toBeCallableWith('1', false);
        expect(typed).type.not.toBeCallableWith(1, false);
        expect(typed('1', false)).type.toBe<User>();
        expect(voidCallback).type.toBe<() => void>();
    });

    test('creates fixed-resolution doubles', function () {
        const untyped = testDouble.resolves(user);
        const typed = testDouble.resolves<SaveUser>(user);

        expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => Promise<User>>();
        expect(typed).type.toBe<TestDouble<SaveUser>>();
        expect(typed).type.toBeCallableWith(user);
        expect(typed).type.not.toBeCallableWith('user');
        expect(typed(user)).type.toBe<Promise<User>>();
        expect(testDouble.resolves<LoadUser>).type.not.toBeCallableWith(user);
    });

    test('creates fixed-rejection doubles', function () {
        const untyped = testDouble.rejects(new Error('expected'));
        const typed = testDouble.rejects<SaveUser>(new Error('expected'));

        expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => Promise<never>>();
        expect(typed).type.toBe<TestDouble<SaveUser>>();
        expect(typed).type.toBeCallableWith(user);
        expect(typed(user)).type.toBe<Promise<User>>();
        expect(testDouble.rejects<LoadUser>).type.not.toBeCallableWith(new Error('expected'));
    });

    test('creates fixed-throw doubles', function () {
        const untyped = testDouble.throws(new Error('expected'));
        const typed = testDouble.throws<LoadUser>(new Error('expected'));

        expect(untyped).type.toBe<(...arguments_: readonly unknown[]) => never>();
        expect(typed).type.toBe<TestDouble<LoadUser>>();
        expect(typed).type.toBeCallableWith('1', false);
        expect(typed('1', false)).type.toBe<User>();
        expect(testDouble.throws<SaveUser>).type.not.toBeCallableWith(new Error('expected'));
    });

    test('creates fixed-construction doubles', function () {
        const untyped = testDouble.constructs(client);
        const TypedClient = testDouble.constructs<ClientConstructor>(client);

        expect(untyped).type.toBe<new (...arguments_: readonly unknown[]) => Client>();
        expect(TypedClient).type.toBe<TestDouble<ClientConstructor>>();
        expect(new TypedClient('https://api.example.test')).type.toBe<Client>();
    });

    test('does not expose fluent behavior on created doubles', function () {
        const typed = testDouble.returns<LoadUser>(user);

        expect(typed).type.not.toHaveProperty('returns');
        expect(typed).type.not.toHaveProperty('resolves');
        expect(typed).type.not.toHaveProperty('rejects');
        expect(typed).type.not.toHaveProperty('throws');
        expect(typed).type.not.toHaveProperty('constructs');
    });
});
