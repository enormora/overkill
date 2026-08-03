import { describe, expect, test } from 'tstyche';
import {
    rule,
    testDouble
} from './doubles.entry-point.ts';

type LoadEvents = (id: string) => Generator<string, number, boolean>;
type LoadAsyncEvents = (id: string) => AsyncGenerator<string, number, boolean>;

describe('@overkill-dev/doubles generator rules', function () {
    test('type-checks sync generator rules and fallback behavior', function () {
        expect(testDouble<LoadEvents>).type.toBeCallableWith({
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

    test('type-checks async generator rules and fallback behavior', function () {
        expect(testDouble<LoadAsyncEvents>).type.toBeCallableWith({
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

    test('rejects mismatched generator rules and construction terminators', function () {
        expect(testDouble<LoadEvents>).type.not.toBeCallableWith({
            rules: [ rule.when('1').yieldsAsync([ 'event' ]) ]
        });
        expect(testDouble<LoadAsyncEvents>).type.not.toBeCallableWith({
            rules: [ rule.when('1').yields([ 'event' ]) ]
        });
        expect(rule.whenConstructedWith('https://api.example.test')).type.not.toHaveProperty('yields');
        expect(rule.whenConstructedWith('https://api.example.test')).type.not.toHaveProperty('yieldsAsync');
    });
});
