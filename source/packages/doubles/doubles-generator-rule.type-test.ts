import { suite, test } from '@overkill-dev/test';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
import { hasKey } from '../../test-support/type-relations.ts';
import {
    rule,
    testDouble
} from './doubles.entry-point.ts';

type LoadEvents = (id: string) => Generator<string, number, boolean>;
type LoadAsyncEvents = (id: string) => AsyncGenerator<string, number, boolean>;

export const testNode = suite('Generator rules and yield inference', [
    test('type-checks sync generator rules and fallback behavior', function (scope) {
        scope.assert(acceptsCall, function () {
            return testDouble<LoadEvents>({
                rules: [
                    rule.when('1').yields<LoadEvents>([ 'event' ], 1),
                    rule.onCall(1).yieldsFrom<LoadEvents>(function* loadEvents(id) {
                        yield id;
                        return 1;
                    })
                ],
                fallback: rule.yields<LoadEvents>([ 'fallback' ], 1)
            });
        });
        return scope.assert.collect();
    }),
    test('type-checks async generator rules and fallback behavior', function (scope) {
        scope.assert(acceptsCall, function () {
            return testDouble<LoadAsyncEvents>({
                rules: [
                    rule.when('1').yieldsAsync<LoadAsyncEvents>([ 'event' ], 1),
                    rule.onCall(1).yieldsAsyncFrom<LoadAsyncEvents>(function* loadEvents(id) {
                        yield id;
                        return 1;
                    })
                ],
                fallback: rule.yieldsAsync<LoadAsyncEvents>([ 'fallback' ], 1)
            });
        });
        return scope.assert.collect();
    }),
    test('rejects mismatched generator rules and construction terminators', function (scope) {
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<LoadEvents>({
                rules: [ rule.when('1').yieldsAsync([ 'event' ]) ]
            });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return testDouble<LoadAsyncEvents>({
                rules: [ rule.when('1').yields([ 'event' ]) ]
            });
        });
        const constructorRule = rule.whenConstructedWith('https://api.example.test');
        scope.assert(sameType.withActual<false>(), hasKey<'yields'>()(constructorRule));
        scope.assert(sameType.withActual<false>(), hasKey<'yieldsAsync'>()(constructorRule));
        return scope.assert.collect();
    })
]);
