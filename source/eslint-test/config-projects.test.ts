import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as parser from '@typescript-eslint/parser';
import { ESLintUtils } from '@typescript-eslint/utils';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { gen } from '../packages/property/property.entry-point.ts';
import { defineConfigTests, type ConfigInput } from '../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, emptyConfigProject, executeConfigNode } from '../test-support/eslint-config.ts';
import { executePropertyNode, integrationPropertyExecutionDefaults } from '../test-support/property-execution.ts';
import { nativeRule } from './rule-implementation.ts';

const typedRule = ESLintUtils.RuleCreator.withoutDocs({
    defaultOptions: [],
    meta: { type: 'problem', schema: [], messages: { typed: 'typed' } },
    create(context) {
        const services = ESLintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
            VariableDeclarator(node) {
                const type = checker.typeToString(services.getTypeAtLocation(node.id));
                if (type !== 'number') {
                    throw new Error(`Expected a number from the generated companion: ${type}`);
                }
            }
        };
    }
});

export const testNode = suite('config project contexts', [
    test('uses generated source and companion files in a real TypeScript project', async function (scope) {
        const roots: string[] = [];
        const definitions = defineConfigTests({
            ...configDefinition([]),
            configs: {
                basic(context) {
                    roots.push(context.root);
                    return [ {
                        files: [ '**/*.ts' ],
                        languageOptions: {
                            parser,
                            parserOptions: {
                                project: './tsconfig.json',
                                tsconfigRootDir: context.root,
                                disallowAutomaticSingleRunInference: true
                            }
                        },
                        plugins: { typed: { rules: { rule: nativeRule(typedRule) } } },
                        rules: { 'typed/rule': 'error' }
                    } ];
                }
            },
            generation: [ {
                title: 'typed',
                configs: 'all',
                project: {
                    ...emptyConfigProject,
                    files: {
                        'tsconfig.json':
                            '{"compilerOptions":{"strict":true,"module":"NodeNext","moduleResolution":"NodeNext"},"include":["*.ts"]}'
                    }
                },
                generator: {
                    kind: 'custom',
                    input: gen.constant(null).map(function input(): ConfigInput {
                        return {
                            filename: 'entry.ts',
                            code: 'import { count } from "./support.js";\nconst value = count;',
                            files: { 'support.ts': 'export const count: number = 1;' }
                        };
                    })
                },
                contracts: [ { kind: 'crash-freedom' } ]
            } ]
        });
        const result = await executePropertyNode(definitions.properties(), {
            ...integrationPropertyExecutionDefaults,
            policy: { ...integrationPropertyExecutionDefaults.policy, newTrials: 1 }
        });
        scope.assert.equal(result.summary.passed, 1);
        for (const root of roots) {
            await scope.assert.rejects(async function removed() {
                await access(root);
            }, { message: /ENOENT/ });
        }
        return scope.assert.collect();
    }),
    test('reads existing projects without altering authored files', async function (scope) {
        const root = process.cwd();
        const filename = 'package.json';
        const before = await readFile(path.join(root, filename), 'utf8');
        const definitions = defineConfigTests({
            ...configDefinition([ {
                files: [ '**/*.json' ],
                processor: {
                    preprocess() {
                        return [ '' ];
                    },
                    postprocess(messages) {
                        return messages.flat();
                    }
                }
            } ]),
            project: { kind: 'existing', root },
            fixtures: [
                {
                    title: 'existing',
                    configs: 'all',
                    source: { kind: 'file', filename },
                    expect: { kind: 'lint', diagnostics: { kind: 'clean' } }
                }
            ]
        });
        const result1 = await executeConfigNode(definitions.fixtures());
        scope.assert.equal(result1.summary.passed, 1);
        scope.assert.equal(await readFile(path.join(root, filename), 'utf8'), before);
        return scope.assert.collect();
    }),
    ...[ '/absolute.js', '../escape.js', 'a/../../escape.js', 'a\\b.js', '' ].map(function filename(value) {
        return test(`rejects unsafe project filename ${JSON.stringify(value)}`, function (scope) {
            scope.assert.throws(function invalid() {
                defineConfigTests({
                    ...configDefinition([]),
                    project: { ...emptyConfigProject, files: { [value]: '' } }
                });
            }, { message: /Project filenames/ });
            return scope.assert.collect();
        });
    }),
    ...[ { a: '', 'a/b.js': '' }, { 'same.js': '', './same.js': '' }, { 'node_modules/file.js': '' }, {
        'NODE_MODULES/file.js': ''
    } ]
        .map(
            function files(value) {
                return test(`rejects conflicting project files ${JSON.stringify(value)}`, function (scope) {
                    scope.assert.throws(function invalid() {
                        defineConfigTests({
                            ...configDefinition([]),
                            project: { ...emptyConfigProject, files: value }
                        });
                    }, { message: /Project file/ });
                    return scope.assert.collect();
                });
            }
        )
]);
