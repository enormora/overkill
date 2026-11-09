import { expect, test } from 'tstyche';
import type { PropertyBody, PropertySampleScope } from '../property/property.entry-point.ts';
import { differential } from './differential.entry-point.ts';

test('infers output and preserves typed reconstruction', function () {
    const body = differential({
        implementations: [
            {
                name: 'one',
                run: String
            },
            {
                name: 'two',
                async run(input: number) {
                    return input.toString();
                }
            }
        ],
        check(observations, sample) {
            expect(sample).type.toBe<PropertySampleScope<number>>();
            expect(observations[0].input).type.toBe<number>();
            const { outcome } = observations[0];
            if (outcome.kind === 'returned') {
                expect(outcome.value).type.toBe<string>();
            } else {
                expect(outcome.error).type.toBe<unknown>();
            }
            return sample.assert.collect();
        }
    });
    expect(body).type.toBe<PropertyBody<number>>();
});

test('rejects a single implementation', function () {
    expect(differential<number, number>).type.not.toBeCallableWith({
        implementations: [ {
            name: 'only',
            run(input: number) {
                return input;
            }
        } ],
        check() {
            throw new Error('not executed');
        }
    });
});
