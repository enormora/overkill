import { suite, test } from '@overkill-dev/test-type-authoring';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
import { P } from 'ts-pattern';
import { isAssignableTo } from '../../test-support/type-relations.ts';
import { matches, rule, testDouble, type ArgumentMatcher } from './doubles.entry-point.ts';

type LoadOptions = { readonly limit: number; };
type Client = { readonly id: string; };
type ClientConstructor = new (id: string) => Client;
type Role = 'admin' | 'guest';
type RoleOptions = { readonly role: Role; };
type Load = (id: string, options: LoadOptions) => string;

export const testNode = suite('typed argument patterns', [
    test('preserves compatible patterns and return types', function (typeScope) {
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<ArgumentMatcher>()(matches(P.string)));
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<ArgumentMatcher>()(matches(P._)));
        const config = {
            rules: [ rule.when(matches(P.string), matches({ limit: P.number })).returns('found') ]
        };
        typeScope.assert(acceptsCall, () => testDouble<Load>(config));
        const load = testDouble<Load>(config);
        typeScope.assert(sameType.withActual<string>(), load('id', { limit: 1 }));
        return typeScope.assert.collect();
    }),
    test('supports nested wildcards and collections', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<Load>({
                rules: [ rule.when(matches(P.string), matches({ limit: P._ })).returns('found') ]
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<(values: ReadonlyMap<string, string>) => string>({
                rules: [ rule.when(matches(P.map(P.string, P._))).returns('found') ]
            }));
        return typeScope.assert.collect();
    }),
    test('supports primitive matchers for literal unions', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<(role: Role) => string>({
                rules: [ rule.when(matches(P.string)).returns('found') ]
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<(options: RoleOptions) => string>({
                rules: [ rule.when(matches({ role: P.string })).returns('found') ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<(role: Role) => string>({
                rules: [ rule.when(matches('root')).returns('found') ]
            }));
        return typeScope.assert.collect();
    }),
    test('rejects incompatible patterns and results', function (typeScope) {
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<Load>({
                rules: [ rule.when(matches(P.number)).returns('found') ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<Load>({
                rules: [ rule.when(matches(P.string), matches({ limit: P.string })).returns('found') ]
            }));
        typeScope.assert(
            rejectsCall('argument-type'),
            () => testDouble<Load>({ rules: [ rule.when(matches(P.string)).returns(1) ] })
        );
        return typeScope.assert.collect();
    }),
    test('supports wildcards optional arguments and constructors', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<(id?: string) => string>({
                rules: [ rule.when(matches(undefined)).returns('found') ]
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<(id: string, limit?: number) => string>({
                rules: [ rule.when(matches(P.string), matches(undefined)).returns('found') ]
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<(id?: string) => string>({
                rules: [ rule.when(matches(P._)).returns('found') ]
            }));
        typeScope.assert(acceptsCall, () =>
            testDouble<ClientConstructor>({
                rules: [ rule.whenConstructedWith(matches(P.string)).constructs({ id: 'client' }) ]
            }));
        return typeScope.assert.collect();
    })
]);
