import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { PropertyBody, PropertySampleScope } from '../property/property.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { differential } from './differential.entry-point.ts';

export const testNode = suite('differential', [
    test('infers output and preserves typed reconstruction', function (typeScope) {
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
                typeScope.assert(sameType<IsEqual<typeof sample, PropertySampleScope<number>>, true>());
                typeScope.assert(sameType.withActual<number>(), observations[0].input);
                const { outcome } = observations[0];
                if (outcome.kind === 'returned') {
                    typeScope.assert(sameType.withActual<string>(), outcome.value);
                } else {
                    typeScope.assert(sameType.withActual<unknown>(), outcome.error);
                }
                return sample.assert.collect();
            }
        });
        typeScope.assert(sameType.withActual<true>(), isEqualTo<PropertyBody<number>>()(body));
        return typeScope.assert.collect();
    }),
    test('rejects a single implementation', function (typeScope) {
        typeScope.assert(rejectsCall('argument-type'), () =>
            differential<number, number>({
                implementations: [ {
                    name: 'only',
                    run(input: number) {
                        return input;
                    }
                } ],
                check() {
                    throw new Error('not executed');
                }
            }));
        return typeScope.assert.collect();
    })
]);
