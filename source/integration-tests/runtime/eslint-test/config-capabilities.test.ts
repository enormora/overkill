import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { table, suite, test } from '@overkill-dev/test';

import * as parser from '@typescript-eslint/parser';
import { createTemporaryDirectoryResource, startResources } from '../../../packages/resources/resources.entry-point.ts';

import { gen } from '../../../packages/property/property.entry-point.ts';
import {
    defineConfigTests,
    type ConfigFixture,
    type ConfigGeneration,
    type ConfigInput
} from '../../../packages/eslint-test/eslint-test.entry-point.ts';
import { configDefinition, emptyConfigProject, executeConfigNode } from '../../../test-support/eslint-config.ts';
import { executePropertyNode, integrationPropertyExecutionDefaults } from '../../../test-support/property-execution.ts';

const generation: ConfigGeneration<'basic'> = {
    title: 'candidate',
    configs: 'all',
    project: emptyConfigProject,
    generator: {
        kind: 'custom',
        input: gen.constant(null).map(function input(): ConfigInput {
            return { filename: 'file.js', code: 'const =', files: {} };
        })
    },
    contracts: [ { kind: 'crash-freedom' } ]
};
const propertyRequest = {
    ...integrationPropertyExecutionDefaults,
    policy: { ...integrationPropertyExecutionDefaults.policy, newTrials: 1 }
};

export const testNode = suite('config project capabilities', [
    test('inline fixtures cannot write through linked dependency directories', async function (scope) {
        await using resources = await startResources({
            resources: { directory: createTemporaryDirectoryResource('dependency-fixture') },
            signal: scope.signal
        });
        const sentinel = path.join(resources.context.directory.path, 'node_modules/sentinel.js');
        await mkdir(path.dirname(sentinel), { recursive: true });
        await writeFile(sentinel, 'unchanged');
        const definitions = defineConfigTests({
            ...configDefinition([]),
            project: {
                ...emptyConfigProject,
                dependencies: {
                    kind: 'from-project',
                    root: resources
                        .context
                        .directory
                        .path
                }
            },
            fixtures: [ 'node_modules', 'NODE_MODULES' ].map(function directory(name): ConfigFixture<'basic'> {
                return {
                    title: name,
                    configs: 'all',
                    source: { kind: 'inline', filename: `${name}/sentinel.js`, code: 'changed' },
                    expect: { kind: 'lint', diagnostics: { kind: 'clean' } }
                };
            })
        });
        const result = await executeConfigNode(definitions.fixtures());
        scope.assert.equal(result.summary.failed, 2);
        scope.assert.deepEqual(
            result.perTest.map(function rejected(entry) {
                return JSON.stringify(entry.outcome).includes('Project inputs must not write into node_modules.');
            }),
            [ true, true ]
        );
        scope.assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
        return scope.assert.collect();
    }),
    table({
        title: 'cleans up installed dependencies after factory failure',
        cases: [ false, true ],
        caseTitle: String,
        async test(scope) {
            const shouldFail = scope.parameters;

            const roots: string[] = [];
            const definitions = defineConfigTests({
                ...configDefinition([]),
                project: { ...emptyConfigProject, dependencies: { kind: 'from-project', root: process.cwd() } },
                configs: {
                    async basic(context) {
                        roots.push(context.root);
                        const manifest: unknown = JSON.parse(
                            await readFile(path.join(context.root, 'node_modules/typescript/package.json'), 'utf8')
                        );
                        if (
                            typeof manifest !== 'object' || manifest === null ||
                            Reflect.get(manifest, 'name') !== 'typescript'
                        ) {
                            throw new Error('Dependency link did not resolve TypeScript.');
                        }
                        if (shouldFail) {
                            throw new Error('factory failed');
                        }
                        return [];
                    }
                },
                files: [ {
                    title: 'file',
                    configs: 'all',
                    filename: 'file.js',
                    expect: { kind: 'included', rules: {}, ruleMatch: 'subset', languageOptions: {}, settings: {} }
                } ]
            });
            const result = await executeConfigNode(definitions.checks());
            scope.assert.equal(result.summary.passed, shouldFail ? 0 : 1);
            scope.assert.equal(roots.length, 1);
            for (const root of roots) {
                await scope.assert.rejects(async function removed() {
                    await access(root);
                }, { message: /ENOENT/ });
            }
            return scope.assert.collect();
        }
    }),
    test('compares supplied parser identity without cloning plugin objects', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([ { files: [ '**/*.ts' ], languageOptions: { parser } } ]),
            files: [
                {
                    title: 'parser',
                    configs: 'all',
                    filename: 'file.ts',
                    expect: {
                        kind: 'included',
                        rules: {},
                        ruleMatch: 'subset',
                        languageOptions: { parser },
                        settings: {}
                    }
                }
            ]
        });
        const result = await executeConfigNode(definitions.checks());
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    table({
        title: 'ignored filenames exhaust candidate batches inconclusively',
        cases: [ false, true ],
        caseTitle: String,
        async test(scope) {
            const ignored = scope.parameters;

            const definitions = defineConfigTests({
                ...configDefinition(ignored ? [ { ignores: [ '**/file.js' ] } ] : []),
                generation: [ generation ]
            });
            const result = await executePropertyNode(definitions.properties(), propertyRequest);
            scope.assert.deepEqual([ result.summary.inconclusive, result.summary.failed, result.summary.passed ], [
                1,
                0,
                0
            ]);
            return scope.assert.collect();
        }
    }),
    test('parser project setup failures fail instead of discarding candidates', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([ {
                files: [ '**/*.js' ],
                languageOptions: { parser, parserOptions: { project: './missing-tsconfig.json' } }
            } ]),
            generation: [ generation ]
        });
        const result = await executePropertyNode(definitions.properties(), propertyRequest);
        scope.assert.deepEqual([ result.summary.failed, result.summary.inconclusive ], [ 1, 0 ]);
        return scope.assert.collect();
    }),
    test('loads authored file seeds lazily and excludes deliberate parser failures', async function (scope) {
        const definitions = defineConfigTests({
            ...configDefinition([]),
            project: { ...emptyConfigProject, files: { 'file.js': 'var value = 1;' } },
            fixtures: [
                {
                    title: 'seed',
                    configs: 'all',
                    source: { kind: 'file', filename: 'file.js' },
                    expect: { kind: 'lint', diagnostics: { kind: 'clean' } }
                },
                {
                    title: 'parser failure',
                    configs: 'all',
                    source: { kind: 'inline', filename: 'file.js', code: 'const =' },
                    expect: { kind: 'lint', diagnostics: { kind: 'parse-failure', message: /Unexpected token/ } }
                }
            ],
            generation: [ { ...generation, generator: { kind: 'syntax', syntax: 'javascript', filename: 'file.js' } } ]
        });
        const result = await executePropertyNode(definitions.properties(), propertyRequest);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('rejects relative dependency roots and unknown inventory exclusions', function (scope) {
        scope.assert.throws(function dependencyRoot() {
            defineConfigTests({
                ...configDefinition([]),
                project: { ...emptyConfigProject, dependencies: { kind: 'from-project', root: 'relative' } }
            });
        }, { message: /absolute/ });
        scope.assert.throws(function exclusion() {
            defineConfigTests({
                ...configDefinition([]),
                inventories: [ {
                    title: 'catalog',
                    configs: 'all',
                    target: { kind: 'declared' },
                    completeness: 'all',
                    deprecated: 'allow',
                    exclusions: [ { ruleId: 'unknown', reason: 'intentional' } ],
                    catalog: { kind: 'rules', rules: [ { ruleId: 'no-debugger', deprecated: false } ] }
                } ]
            });
        }, { message: /catalog rules/ });
        return scope.assert.collect();
    })
]);
