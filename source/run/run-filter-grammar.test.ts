import { suite, test } from '@overkill-dev/test';

import { parseRunFilterExpression } from './run-filter-grammar.ts';

function parseErrorMessage(expression: string): string | null {
    try {
        parseRunFilterExpression(expression);

        return null;
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const testNode = suite('Run filter grammar', [
    test('parses field operators', function (scope) {
        scope.assert.deepEqual(
            parseRunFilterExpression('tag=fast title~"should " file:source/**/*.test.ts'),
            {
                filters: [
                    { field: 'tag', kind: 'equals', value: 'fast' },
                    { field: 'title', kind: 'contains', value: 'should ' },
                    { field: 'file', kind: 'glob', pattern: 'source/**/*.test.ts' }
                ],
                kind: 'all'
            }
        );

        return scope.assert.collect();
    }),
    test('keeps OR lower precedence than whitespace AND', function (scope) {
        scope.assert.deepEqual(
            parseRunFilterExpression('tag=fast | tag=slow owner=@runtime'),
            {
                filters: [
                    { field: 'tag', kind: 'equals', value: 'fast' },
                    {
                        filters: [
                            { field: 'tag', kind: 'equals', value: 'slow' },
                            { field: 'owner', kind: 'equals', value: '@runtime' }
                        ],
                        kind: 'all'
                    }
                ],
                kind: 'any'
            }
        );

        return scope.assert.collect();
    }),
    test('parses negated groups', function (scope) {
        scope.assert.deepEqual(
            parseRunFilterExpression('!(tag=flaky | owner=@old) tag=stable'),
            {
                filters: [
                    {
                        filter: {
                            filters: [
                                { field: 'tag', kind: 'equals', value: 'flaky' },
                                { field: 'owner', kind: 'equals', value: '@old' }
                            ],
                            kind: 'any'
                        },
                        kind: 'not'
                    },
                    { field: 'tag', kind: 'equals', value: 'stable' }
                ],
                kind: 'all'
            }
        );

        return scope.assert.collect();
    }),
    test('unescapes quoted values', function (scope) {
        scope.assert.deepEqual(parseRunFilterExpression('title~"should \\"quote\\""'), {
            field: 'title',
            kind: 'contains',
            value: 'should "quote"'
        });
        scope.assert.deepEqual(parseRunFilterExpression("suite~'root \\' branch'"), {
            field: 'suite',
            kind: 'contains',
            value: "root ' branch"
        });
        scope.assert.deepEqual(parseRunFilterExpression('tag=fast   '), {
            field: 'tag',
            kind: 'equals',
            value: 'fast'
        });

        return scope.assert.collect();
    }),
    test('accepts supported string dimensions', function (scope) {
        scope.assert.deepEqual(
            parseRunFilterExpression(
                'file:source/**/*.test.ts title~smoke owner=@payments params~EUR suite~checkout tag:critical-*'
            ),
            {
                filters: [
                    { field: 'file', kind: 'glob', pattern: 'source/**/*.test.ts' },
                    { field: 'title', kind: 'contains', value: 'smoke' },
                    { field: 'owner', kind: 'equals', value: '@payments' },
                    { field: 'params', kind: 'contains', value: 'EUR' },
                    { field: 'suite', kind: 'contains', value: 'checkout' },
                    { field: 'tag', kind: 'glob', pattern: 'critical-*' }
                ],
                kind: 'all'
            }
        );

        return scope.assert.collect();
    }),
    test('rejects malformed expressions', function (scope) {
        const malformedExpressions: readonly (readonly [string, string])[] = [
            [ ' ', 'Run filter expression must not be empty.' ],
            [ '=fast', 'Expected a run filter dimension.' ],
            [ 'kind=microtest', 'Unknown run filter dimension: kind' ],
            [ 'tag=fast)', 'Unexpected token: )' ],
            [ 'tag=fast |', 'Expected a filter term.' ],
            [ '(tag=fast', 'Expected closing parenthesis.' ],
            [ 'tag=', 'Run filter value must not be empty.' ],
            [ 'title~""', 'Run filter value must not be empty.' ],
            [ 'tag fast', 'Expected one of =, ~, or : after run filter dimension.' ],
            [ 'title~"unterminated', 'Unterminated double quote string.' ],
            [ 'title~"unterminated\\', 'Unterminated double quote string.' ],
            [ "suite~'unterminated", 'Unterminated single quote string.' ],
            [ '()', 'Expected a run filter dimension.' ]
        ];

        for (const [ expression, expectedMessage ] of malformedExpressions) {
            scope.assert.includes(parseErrorMessage(expression) ?? '', expectedMessage);
        }

        return scope.assert.collect();
    })
]);
