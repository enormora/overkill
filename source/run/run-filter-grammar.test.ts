import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { parseRunFilterExpression } from './run-filter-grammar.ts';

function parseErrorMessage(expression: string): string | null {
    try {
        parseRunFilterExpression(expression);

        return null;
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-filter-grammar.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'parseRunFilterExpression() parses field operators',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'parseRunFilterExpression() keeps OR lower precedence than whitespace AND',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'parseRunFilterExpression() parses negated groups',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'parseRunFilterExpression() unescapes quoted values',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'parseRunFilterExpression() accepts supported string dimensions',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'parseRunFilterExpression() rejects malformed expressions',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
