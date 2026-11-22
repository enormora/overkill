import type { Rule } from 'eslint';
import { z } from 'zod';
import { suite, test } from '@overkill-dev/test';

import { optionInputs } from '../../../eslint-test/option-schemas.ts';
import { sampleGenerator } from '../../../packages/property/property.entry-point.ts';

type RuleSchema = NonNullable<Rule.RuleMetaData['schema']>;
const request = { seed: 42n, count: 24, size: 6, depth: 4 };

function sampleOptions(schema: RuleSchema): readonly (readonly unknown[])[] {
    return sampleGenerator(
        optionInputs({
            meta: { schema },
            create() {
                return {};
            }
        }),
        request
    );
}

export const testNode = suite('ESLint option validation', [
    test('passes generated options through native ESLint validation', function (scope) {
        const values = sampleOptions({
            type: 'array',
            items: { type: 'integer', minimum: 1, maximum: 5, exclusiveMinimum: true, exclusiveMaximum: true },
            minItems: 1,
            maxItems: 1
        });
        scope.assert.equal(values.length, request.count);
        scope.assert.true(values.every(function valid(options) {
            return z.tuple([ z.number().int().gt(1).lt(5) ]).safeParse(options).success;
        }));
        return scope.assert.collect();
    }),
    test('rules without option schemas generate empty option lists', function (scope) {
        const values = sampleGenerator(
            optionInputs({
                create() {
                    return {};
                }
            }),
            request
        );
        scope.assert.deepEqual(
            values,
            Array.from({ length: request.count }, function empty() {
                return [];
            })
        );
        return scope.assert.collect();
    }),
    test('schema false permits arbitrary JSON option lists', function (scope) {
        const values = sampleOptions(false);
        scope.assert.equal(values.length, request.count);
        scope.assert.true(values.every(function valid(options) {
            return z.array(z.json()).max(5).safeParse(options).success;
        }));
        scope.assert.true(values.some(function populated(options) {
            return options.length > 0;
        }));
        return scope.assert.collect();
    })
]);
