import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, rejectsCall } from '@overkill-dev/type-test';
import {
    rule,
    testDouble
} from './doubles.entry-point.ts';

type LoadEvents = (id: string) => Generator<string, number, boolean>;
type LoadAsyncEvents = (id: string) => AsyncGenerator<string, number, boolean>;

export const testNode = suite('@overkill-dev/doubles generator rules', [
    test('type-checks sync generator rules and fallback behavior', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<LoadEvents>({
                rules: [
                    rule.when('1').yields<LoadEvents>([ 'event' ], 1),
                    rule.onCall(1).yieldsFrom<LoadEvents>(function* loadEvents(id) {
                        yield id;
                        return 1;
                    })
                ],
                fallback: rule.yields<LoadEvents>([ 'fallback' ], 1)
            }));
        return typeScope.assert.collect();
    }),
    test('type-checks async generator rules and fallback behavior', function (typeScope) {
        typeScope.assert(acceptsCall, () =>
            testDouble<LoadAsyncEvents>({
                rules: [
                    rule.when('1').yieldsAsync<LoadAsyncEvents>([ 'event' ], 1),
                    rule.onCall(1).yieldsAsyncFrom<LoadAsyncEvents>(function* loadEvents(id) {
                        yield id;
                        return 1;
                    })
                ],
                fallback: rule.yieldsAsync<LoadAsyncEvents>([ 'fallback' ], 1)
            }));
        return typeScope.assert.collect();
    }),
    test('rejects mismatched generator rules and construction terminators', function (typeScope) {
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<LoadEvents>({
                rules: [ rule.when('1').yieldsAsync([ 'event' ]) ]
            }));
        typeScope.assert(rejectsCall('argument-type'), () =>
            testDouble<LoadAsyncEvents>({
                rules: [ rule.when('1').yields([ 'event' ]) ]
            }));
        const constructorRule = rule.whenConstructedWith('https://api.example.test');
        typeScope.assert(assignableFrom.not<keyof typeof constructorRule, 'yields'>());
        typeScope.assert(assignableFrom.not<keyof typeof constructorRule, 'yieldsAsync'>());
        return typeScope.assert.collect();
    })
]);
