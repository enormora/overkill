import { suite, test } from '@overkill-dev/test';

import { safeParse } from '@schema-hub/zod-error-formatter';

import { microtestProfileSchema } from './schema.ts';

function validationIssues(data: unknown): readonly string[] {
    const result = safeParse(microtestProfileSchema, data);

    return result.success ? [] : result.error.issues;
}

export const testNode = suite('Coverage policy', [
    test('accepts every output and all-files source policy', function (scope) {
        scope.assert.deepEqual(
            validationIssues({
                coverage: {
                    outputDir: 'coverage',
                    outputs: [ 'html', 'json', 'lcov', 'text', 'v8' ],
                    sources: {
                        exclude: [ '**/*.generated.ts' ],
                        include: [ 'source/**/*.ts' ],
                        mode: 'all'
                    },
                    thresholds: { branches: 80, functions: 90, lines: 100 }
                },
                testFamily: 'microtest'
            }),
            []
        );

        return scope.assert.collect();
    }),
    test('validates thresholds and all-files includes', function (scope) {
        scope.assert.deepEqual(
            validationIssues({
                coverage: { thresholds: { lines: 101 } },
                testFamily: 'microtest'
            }),
            [ 'at coverage.thresholds.lines: number must be less than or equal to 100' ]
        );
        scope.assert.deepEqual(
            validationIssues({
                coverage: { sources: { include: [], mode: 'all' } },
                testFamily: 'microtest'
            }),
            [ 'at coverage.sources.include[0]: missing key; expected string' ]
        );

        return scope.assert.collect();
    })
]);
