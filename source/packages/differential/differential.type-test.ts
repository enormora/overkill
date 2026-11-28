import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import type { PropertyBody, PropertySampleScope } from '../property/property.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { differential } from './differential.entry-point.ts';

export const testNode = suite('Differential oracles and observation inference', [
    test('infers output and preserves typed reconstruction', function (scope) {
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
                scope.assert(sameType<IsEqual<typeof sample, PropertySampleScope<number>>, true>());
                scope.assert(sameType.withActual<number>(), observations[0].input);
                const { outcome } = observations[0];
                if (outcome.kind === 'returned') {
                    scope.assert(sameType.withActual<string>(), outcome.value);
                } else {
                    scope.assert(sameType.withActual<unknown>(), outcome.error);
                }
                return sample.assert.collect();
            }
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<PropertyBody<number>>()(body));
        return scope.assert.collect();
    }),
    test('rejects a single implementation', function (scope) {
        scope.assert(rejectsCall('argument-type'), function () {
            return differential<number, number>({
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
        return scope.assert.collect();
    })
]);
