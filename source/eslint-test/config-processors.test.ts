import { suite as authoredSuite, test } from '@overkill-dev/test';
import type { Linter, Rule } from 'eslint';

import { defineConfigTests } from '../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, executeConfigNode } from '../test-support/eslint-config.ts';

const rule: Rule.RuleModule = {
    meta: { schema: [], fixable: 'code' },
    create(context) {
        return {
            Identifier(node) {
                if (node.name === 'bad') {
                    context.report({
                        node,
                        message: 'Use good.',
                        fix(fixer) {
                            return fixer.replaceText(node, 'good');
                        }
                    });
                }
            }
        };
    }
};
const processor: Linter.Processor = {
    supportsAutofix: true,
    preprocess(code) {
        return [ code.slice(6, -4) ];
    },
    postprocess(blocks) {
        return blocks.flat().map(function original(message) {
            const { fix } = message;
            return {
                ...message,
                line: message.line + 1,
                ...fix === undefined ? {} : { fix: { ...fix, range: [ fix.range[0] + 6, fix.range[1] + 6 ] } }
            };
        });
    }
};

export const testNode = authoredSuite('config processor regressions', [
    test('preserves original document locations and uses processor-aware native autofixing', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([ {
                files: [ '**/*.md' ],
                processor,
                plugins: { local: { rules: { rule } } },
                rules: { 'local/rule': 'error' }
            } ]),
            fixtures: [ {
                title: 'document',
                configs: 'all',
                source: { kind: 'inline', filename: 'sample.md', code: '```js\nbad;\n```' },
                expect: {
                    kind: 'fix',
                    diagnostics: {
                        kind: 'messages',
                        rules: 'all',
                        expected: [ { ruleId: 'local/rule', line: 2, column: 1 } ]
                    },
                    output: { kind: 'text', text: '```js\ngood;\n```' }
                }
            } ]
        });
        const result1 = await executeConfigNode(definitions.fixtures());
        scope.assert.equal(result1.summary.passed, 1);
        return scope.assert.collect();
    })
]);
