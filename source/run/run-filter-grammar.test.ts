import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { parseRunFilterExpression } from './run-filter-grammar.ts';

function parseErrorMessage(expression: string): string | null {
    try {
        parseRunFilterExpression(expression);

        return null;
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-filter-grammar.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'parseRunFilterExpression() parses field operators',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    parseRunFilterExpression('tag=fast name~"should " file:source/**/*.test.ts'),
                    {
                        filters: [
                            { field: 'tag', kind: 'equals', value: 'fast' },
                            { field: 'name', kind: 'contains', value: 'should ' },
                            { field: 'file', kind: 'glob', pattern: 'source/**/*.test.ts' }
                        ],
                        kind: 'all'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'parseRunFilterExpression() keeps OR lower precedence than whitespace AND',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    parseRunFilterExpression('tag=fast | tag=slow runtime=node'),
                    {
                        filters: [
                            { field: 'tag', kind: 'equals', value: 'fast' },
                            {
                                filters: [
                                    { field: 'tag', kind: 'equals', value: 'slow' },
                                    { field: 'runtime', kind: 'equals', value: 'node' }
                                ],
                                kind: 'all'
                            }
                        ],
                        kind: 'any'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'parseRunFilterExpression() parses negated groups',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    parseRunFilterExpression('!(tag=flaky | owner=@old) stability=stable'),
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
                            { field: 'stability', kind: 'equals', value: 'stable' }
                        ],
                        kind: 'all'
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'parseRunFilterExpression() unescapes quoted values',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(parseRunFilterExpression('name~"should \\"quote\\""'), {
                    field: 'name',
                    kind: 'contains',
                    value: 'should "quote"'
                });
                scope.assert.deepEqual(parseRunFilterExpression("suite~'root \\' branch'"), {
                    field: 'suite',
                    kind: 'contains',
                    value: "root ' branch"
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'parseRunFilterExpression() rejects malformed expressions',
            metadata: {},
            body(scope: OverkillScope) {
                const malformedExpressions: readonly (readonly [string, string])[] = [
                    [ ' ', 'Run filter expression must not be empty.' ],
                    [ 'kind=microtest', 'Unknown run filter dimension: kind' ],
                    [ 'tag=fast |', 'Expected a filter term.' ],
                    [ '(tag=fast', 'Expected closing parenthesis.' ],
                    [ 'tag=', 'Run filter value must not be empty.' ],
                    [ 'tag fast', 'Expected one of =, ~, or : after run filter dimension.' ],
                    [ 'name~"unterminated', 'Unterminated double quote string.' ]
                ];

                for (const [ expression, expectedMessage ] of malformedExpressions) {
                    scope.assert.includes(parseErrorMessage(expression) ?? '', expectedMessage);
                }

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
