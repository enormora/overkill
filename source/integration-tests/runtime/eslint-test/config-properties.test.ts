import { suite, test, type TestScope } from '@overkill-dev/test';

import type { Rule } from 'eslint';

import { gen } from '../../../packages/property/property.entry-point.ts';
import {
    defineConfigTests,
    type ConfigContract,
    type ConfigGeneration,
    type ConfigInput,
    type ConfigTests
} from '../../../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, emptyConfigProject } from '../../../test-support/eslint-config.ts';
import { executePropertyNode, integrationPropertyExecutionDefaults } from '../../../test-support/property-execution.ts';

const generation: ConfigGeneration<'basic'> = {
    title: 'generated',
    configs: 'all',
    project: emptyConfigProject,
    generator: {
        kind: 'custom',
        input: gen.constant(null).map(function input(): ConfigInput {
            return { filename: 'file.js', code: 'var value = 1;', files: {} };
        })
    }
};
const request = {
    ...integrationPropertyExecutionDefaults,
    policy: { ...integrationPropertyExecutionDefaults.policy, newTrials: 1, maxShrinkWork: 1000 }
};

function configuredRule(rule: Rule.RuleModule, contracts: readonly ConfigContract[]): ConfigTests {
    return defineConfigTests({
        ...configDefinition([ { plugins: { subject: { rules: { rule } } }, rules: { 'subject/rule': 'error' } } ]),
        generation: [ { ...generation, contracts } ]
    });
}

export const testNode = suite('config automatic properties', [
    test(
        'fix stability counts complete native fix runs and permits remaining nonfixable reports',
        async function (scope) {
            const rule: Rule.RuleModule = {
                meta: { schema: [], fixable: 'code' },
                create(context) {
                    return {
                        Program(node) {
                            context.report({ node, message: 'Nonfixable policy report.' });
                            if (context.sourceCode.text.includes('= 1')) {
                                context.report({
                                    node,
                                    message: 'Change once.',
                                    fix(fixer) {
                                        return fixer.replaceText(node, 'var value = 2;');
                                    }
                                });
                            }
                        }
                    };
                }
            };
            const enough = configuredRule(rule, [ { kind: 'fix-stability', maxRounds: 2 } ]);
            const bounded = configuredRule(rule, [ { kind: 'fix-stability', maxRounds: 1 } ]);
            const passed = await executePropertyNode(enough.properties(), request);
            const failed = await executePropertyNode(bounded.properties(), request);
            scope.assert.deepEqual([ passed.summary.passed, failed.summary.failed ], [ 1, 1 ]);
            return scope.assert.collect();
        }
    ),
    test('rejects circular fixes even when ESLint returns unchanged text', async function (scope) {
        const definition = configuredRule({
            meta: { schema: [], fixable: 'code' },
            create(context) {
                return {
                    Program(node) {
                        const replacement = context.sourceCode.text.includes('= 1')
                            ? 'var value = 2;'
                            : 'var value = 1;';
                        context.report({
                            node,
                            message: 'Toggle.',
                            fix(fixer) {
                                return fixer.replaceText(node, replacement);
                            }
                        });
                    }
                };
            }
        }, [ { kind: 'fix-stability', maxRounds: 2 } ]);
        const result = await executePropertyNode(definition.properties(), request);
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('accepts suggestions that preserve configured syntax', async function (scope) {
        const definition = configuredRule({
            meta: { schema: [], hasSuggestions: true },
            create(context) {
                return {
                    Program(node) {
                        context.report({
                            node,
                            message: 'Suggest.',
                            suggest: [ {
                                desc: 'Rename.',
                                fix(fixer) {
                                    return fixer.replaceText(node, 'var renamed = 1;');
                                }
                            } ]
                        });
                    }
                };
            }
        }, [ { kind: 'suggestion-syntax' } ]);
        const result = await executePropertyNode(definition.properties(), request);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('provides three independent safety contracts by default', async function (scope) {
        const definitions = defineConfigTests({ ...configDefinition([]), generation: [ generation ] });
        const result = await executePropertyNode(definitions.properties(), request);
        scope.assert.deepEqual([ result.summary.passed, result.summary.failed ], [ 3, 0 ]);
        return scope.assert.collect();
    }),
    test('captures and replays crashing composed rules', async function (scope: TestScope) {
        const definition = configuredRule({
            meta: { schema: [] },
            create() {
                throw new Error('config crash');
            }
        }, [ { kind: 'crash-freedom' } ]);
        const failed = await executePropertyNode(definition.properties(), request);
        const witness = failed.perTest[0]?.property?.invocations[0]?.confirmedWitness;
        scope.require.defined(witness);
        scope.assert.equal(failed.summary.failed, 1);
        const replay = await executePropertyNode(definition.properties(), { ...request, replay: witness });
        scope.assert.equal(replay.summary.failed, 1);
        scope.assert.false(JSON.stringify(witness).includes('overkill-temporary-directory-'));
        return scope.assert.collect();
    }),
    test('rejects autofixes that produce invalid syntax', async function (scope) {
        const definition = configuredRule({
            meta: { schema: [], fixable: 'code' },
            create(context) {
                return {
                    Program(node) {
                        context.report({
                            node,
                            message: 'break',
                            fix(fixer) {
                                return fixer.replaceText(node, '(');
                            }
                        });
                    }
                };
            }
        }, [ { kind: 'fix-syntax' } ]);
        const result1 = await executePropertyNode(definition.properties(), request);
        scope.assert.equal(result1.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('rejects suggestions that produce invalid syntax', async function (scope) {
        const definition = configuredRule({
            meta: { schema: [], hasSuggestions: true },
            create(context) {
                return {
                    Program(node) {
                        context.report({
                            node,
                            message: 'suggest',
                            suggest: [ {
                                desc: 'break',
                                fix(fixer) {
                                    return fixer.replaceText(node, '(');
                                }
                            } ]
                        });
                    }
                };
            }
        }, [ { kind: 'suggestion-syntax' } ]);
        const result2 = await executePropertyNode(definition.properties(), request);
        scope.assert.equal(result2.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('detects stateful diagnostic output across independent executions', async function (scope) {
        let calls = 0;
        const definition = configuredRule({
            meta: { schema: [] },
            create(context) {
                calls += 1;
                const message = `turn ${calls}`;
                return {
                    Program(node) {
                        context.report({ node, message });
                    }
                };
            }
        }, [ { kind: 'repeatability' } ]);
        const result3 = await executePropertyNode(definition.properties(), request);
        scope.assert.equal(result3.summary.failed, 1);
        return scope.assert.collect();
    }),
    test('supports explicit fix stability and bounded syntax-only generation', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([]),
            generation: [ {
                ...generation,
                generator: { kind: 'syntax', filename: 'file.js', syntax: 'javascript' },
                contracts: [ { kind: 'fix-stability', maxRounds: 2 } ]
            } ]
        });
        const result4 = await executePropertyNode(definitions.properties(), request);
        scope.assert.equal(result4.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('uses authored fixture seeds without transferring their expectations', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([]),
            fixtures: [ {
                title: 'label',
                configs: 'all',
                source: { kind: 'inline', filename: 'file.js', code: 'value;' },
                expect: {
                    kind: 'lint',
                    diagnostics: { kind: 'messages', rules: 'all', expected: [ { ruleId: 'no-debugger' } ] }
                }
            } ],
            generation: [ { ...generation, contracts: [ { kind: 'crash-freedom' } ] } ]
        });
        const result5 = await executePropertyNode(definitions.properties(), request);
        scope.assert.equal(result5.summary.passed, 1);
        return scope.assert.collect();
    })
]);
