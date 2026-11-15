import { describe, expect, test } from 'tstyche';
import { P } from 'ts-pattern';
import { matches, rule, testDouble, type ArgumentMatcher } from './doubles.entry-point.ts';

type LoadOptions = { readonly limit: number; };
type Client = { readonly id: string; };
type ClientConstructor = new (id: string) => Client;
type Role = 'admin' | 'guest';
type RoleOptions = { readonly role: Role; };
type Load = (id: string, options: LoadOptions) => string;

describe('typed argument patterns', function () {
    test('preserves compatible patterns and return types', function () {
        expect(matches(P.string)).type.toBeAssignableTo<ArgumentMatcher>();
        expect(matches(P._)).type.toBeAssignableTo<ArgumentMatcher>();
        const config = {
            rules: [ rule.when(matches(P.string), matches({ limit: P.number })).returns('found') ]
        };
        expect(testDouble<Load>).type.toBeCallableWith(config);
        const load = testDouble<Load>(config);
        expect(load('id', { limit: 1 })).type.toBe<string>();
    });

    test('supports nested wildcards and collections', function () {
        expect(testDouble<Load>).type.toBeCallableWith({
            rules: [ rule.when(matches(P.string), matches({ limit: P._ })).returns('found') ]
        });
        expect(testDouble<(values: ReadonlyMap<string, string>) => string>).type.toBeCallableWith({
            rules: [ rule.when(matches(P.map(P.string, P._))).returns('found') ]
        });
    });

    test('supports primitive matchers for literal unions', function () {
        expect(testDouble<(role: Role) => string>).type.toBeCallableWith({
            rules: [ rule.when(matches(P.string)).returns('found') ]
        });
        expect(testDouble<(options: RoleOptions) => string>).type.toBeCallableWith({
            rules: [ rule.when(matches({ role: P.string })).returns('found') ]
        });
        expect(testDouble<(role: Role) => string>).type.not.toBeCallableWith({
            rules: [ rule.when(matches('root')).returns('found') ]
        });
    });

    test('rejects incompatible patterns and results', function () {
        expect(testDouble<Load>).type.not.toBeCallableWith({
            rules: [ rule.when(matches(P.number)).returns('found') ]
        });
        expect(testDouble<Load>).type.not.toBeCallableWith({
            rules: [ rule.when(matches(P.string), matches({ limit: P.string })).returns('found') ]
        });
        expect(testDouble<Load>).type.not.toBeCallableWith({ rules: [ rule.when(matches(P.string)).returns(1) ] });
    });

    test('supports wildcards optional arguments and constructors', function () {
        expect(testDouble<(id?: string) => string>).type.toBeCallableWith({
            rules: [ rule.when(matches(undefined)).returns('found') ]
        });
        expect(testDouble<(id: string, limit?: number) => string>).type.toBeCallableWith({
            rules: [ rule.when(matches(P.string), matches(undefined)).returns('found') ]
        });
        expect(testDouble<(id?: string) => string>).type.toBeCallableWith({
            rules: [ rule.when(matches(P._)).returns('found') ]
        });
        expect(testDouble<ClientConstructor>).type.toBeCallableWith({
            rules: [ rule.whenConstructedWith(matches(P.string)).constructs({ id: 'client' }) ]
        });
    });
});
