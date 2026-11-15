import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineConfigTests, type ConfigFixture } from '../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, executeConfigNode, emptyConfigProject } from '../test-support/eslint-config.ts';

function fixture(title: string, code: string, expect: ConfigFixture<'basic'>['expect']): ConfigFixture<'basic'> {
    return { title, configs: 'all', source: { kind: 'inline', filename: 'sample.js', code }, expect };
}
export const testNode = suite('config fixture regressions', [
    test('honors returned custom assertions and ordinary assertion plans', async function (scope) {
        const definition = defineConfigTests({
            ...configDefinition([]),
            fixtures: [
                fixture('returned failure', 'value;', {
                    kind: 'custom',
                    check(observation, inner) {
                        inner.assert.equal(observation.filename, 'sample.js');
                        const recorded = inner.assert.collect()[0];
                        if (recorded.check !== 'equal') {
                            throw new TypeError('Expected an equality assertion.');
                        }
                        return [ recorded, { ...recorded, expected: 'different.js' } ];
                    }
                }),
                fixture('assertion plan', 'value;', {
                    kind: 'custom',
                    check(observation, inner) {
                        inner.plan(1);
                        inner.assert.equal(observation.filename, 'sample.js');
                        return inner.assert.collect();
                    }
                })
            ]
        });
        const result = await executeConfigNode(definition.fixtures());
        scope.assert.deepEqual([ result.summary.passed, result.summary.failed ], [ 1, 1 ]);
        scope.assert.includes(JSON.stringify(result.perTest), 'different.js');
        return scope.assert.collect();
    }),
    test('compares exact diagnostic text', async function (scope) {
        const definition = defineConfigTests({
            ...configDefinition([ { rules: { 'no-debugger': 'error' } } ]),
            fixtures: [
                fixture('message', 'debugger;', {
                    kind: 'lint',
                    diagnostics: {
                        kind: 'messages',
                        rules: 'all',
                        expected: [ { message: "Unexpected 'debugger' statement." } ]
                    }
                })
            ]
        });
        const result = await executeConfigNode(definition.fixtures());
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('checks clean source, selected diagnostics, exact fixes and expected files', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([ { rules: { 'no-debugger': 'error' } } ]),
            project: { ...emptyConfigProject, files: { 'expected.js': '' } },
            fixtures: [
                fixture('clean', 'const value = 1;', { kind: 'lint', diagnostics: { kind: 'clean' } }),
                fixture('ids', 'debugger;', {
                    kind: 'lint',
                    diagnostics: { kind: 'rule-ids', rules: 'all', expected: [ 'no-debugger' ] }
                }),
                fixture('messages', 'debugger;', {
                    kind: 'lint',
                    diagnostics: {
                        kind: 'messages',
                        rules: [ 'no-debugger' ],
                        expected: [ { ruleId: 'no-debugger', severity: 2, line: 1, message: /debugger/ } ]
                    }
                }),
                fixture('fixed', '', {
                    kind: 'fix',
                    diagnostics: { kind: 'clean' },
                    output: { kind: 'file', filename: 'expected.js' }
                })
            ]
        });
        const result1 = await executeConfigNode(definitions.fixtures());
        scope.assert.equal(result1.summary.passed, 4);
        return scope.assert.collect();
    }),
    test('cannot hide fatal parser errors through rule filtering', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([]),
            fixtures: [
                fixture('fatal', 'const =', {
                    kind: 'lint',
                    diagnostics: { kind: 'rule-ids', rules: [ 'no-debugger' ], expected: [] }
                }),
                fixture('expected fatal', 'const =', {
                    kind: 'lint',
                    diagnostics: { kind: 'parse-failure', message: /Unexpected token/ }
                })
            ]
        });
        const result = await executeConfigNode(definitions.fixtures());
        scope.assert.deepEqual([ result.summary.passed, result.summary.failed ], [ 1, 1 ]);
        return scope.assert.collect();
    }),
    test('rejects silently ignored fixtures and differing output', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([ { ignores: [ '**/sample.js' ] } ]),
            fixtures: [
                fixture('ignored', 'value;', { kind: 'lint', diagnostics: { kind: 'clean' } })
            ]
        });
        const result2 = await executeConfigNode(definitions.fixtures());
        scope.assert.equal(result2.summary.failed, 1);
        const mismatch = defineConfigTests({
            ...configDefinition([]),
            fixtures: [
                fixture('output', 'value;', {
                    kind: 'fix',
                    diagnostics: { kind: 'clean' },
                    output: { kind: 'text', text: 'different;' }
                })
            ]
        });
        const result3 = await executeConfigNode(mismatch.fixtures());
        scope.assert.equal(result3.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('supports observation callbacks and creates independent suites lazily', async function (scope) {
        let resolutions = 0;
        const definitions = defineConfigTests({
            ...configDefinition([]),
            configs: {
                basic() {
                    resolutions += 1;
                    return [];
                }
            },
            fixtures: [
                fixture('custom', 'value;', {
                    kind: 'custom',
                    check(observation, inner) {
                        inner.assert.equal(observation.filename, 'sample.js');
                        return inner.assert.collect();
                    }
                })
            ]
        });
        const first = definitions.fixtures();
        scope.assert.notEqual(first, definitions.fixtures());
        scope.assert.equal(resolutions, 0);
        const result4 = await executeConfigNode(first);
        scope.assert.equal(result4.summary.passed, 1);
        scope.assert.equal(resolutions, 1);
        return scope.assert.collect();
    })
]);
