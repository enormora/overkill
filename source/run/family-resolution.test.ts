import { runIfMain } from '#test-runner';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineTestFamily, type TestFamily } from '../packages/engine/engine.entry-point.ts';
import { normalizeConfig } from '../packages/run/run.entry-point.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import {
    assertFrozenFamilyPreparation,
    resolveFrozenFamily,
    validateFrozenFamilyCollection
} from './family-resolution.ts';
import type { CollectedFamilyMetadata, FrozenFamilyDefinition } from './family-catalog.ts';

function definition(version: string): TestFamily<null> {
    return defineTestFamily({
        id: '@example/checker',
        version,
        module: null,
        features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings(input: unknown) {
            if (input !== null) {
                throw new TypeError('Expected null settings.');
            }
            return null;
        },
        async load() {
            throw new Error('Resolution must not load the backend.');
        }
    });
}

const frozen: FrozenFamilyDefinition = {
    projectRoot: '/project',
    definitionLocationCapture: 'disabled',
    processModel: 'in-process',
    selection: null,
    checkpoint: null,
    source: { kind: 'module', module: { moduleUrl: 'file:///checker.ts', exportName: 'family' } },
    id: '@example/checker',
    version: '1',
    settings: null
};

const collected: CollectedFamilyMetadata = {
    definition: frozen,
    facts: { id: frozen.id, version: frozen.version, settings: null, preparation: null, collection: null }
};

export const testNode = suite('frozen family resolution', [
    ...([ 'builtin', 'config-file' ] as const).map(function builtinSource(kind) {
        return test(`resolves a built-in definition through ${kind}`, async function (scope) {
            const binding = await resolveFrozenFamily(
                {
                    ...frozen,
                    id: 'microtest',
                    source: kind === 'builtin'
                        ? { kind, id: 'microtest' }
                        : { kind, configPath: '/config.ts', profile: 'unit' }
                },
                'in-process',
                {
                    async loadConfig() {
                        return normalizeConfig({ profiles: { unit: { testFamily: 'microtest' } } });
                    },
                    async importModule() {
                        throw new Error('Built-in resolution must not import a module.');
                    }
                }
            );
            scope.assert.equal(binding.testFamily.id, 'microtest');
            scope.assert.equal(binding.settings, null);
            return scope.assert.collect();
        });
    }),
    test('rejects changed configuration settings before backend loading', async function (scope) {
        await scope.assert.rejects(async function resolveChangedConfiguration() {
            await resolveFrozenFamily(
                {
                    ...frozen,
                    settings: 'changed',
                    source: { kind: 'config-file', configPath: '/config.ts', profile: 'unit' }
                },
                'in-process',
                {
                    async loadConfig() {
                        return normalizeConfig({
                            profiles: {
                                unit: { testFamily: definition('1'), settings: null, files: { include: [ 'unit.ts' ] } }
                            }
                        });
                    },
                    async importModule() {
                        throw new Error('Configuration resolution must not fall back to a module.');
                    }
                }
            );
        }, { message: 'Failed to resolve the frozen test family.' });
        return scope.assert.collect();
    }),
    test('accepts complete collection facts with unchanged frozen evidence', function (scope) {
        scope.assert.equal(validateFrozenFamilyCollection(collected, collected, []), collected);
        return scope.assert.collect();
    }),
    test('rejects missing selected collection facts', function (scope) {
        scope.assert.throws(function validateMissingCollection() {
            validateFrozenFamilyCollection(collected, null, []);
        }, { message: 'Selected family collection did not return complete facts.' });
        return scope.assert.collect();
    }),
    test('rejects collection facts accompanied by a loader failure', function (scope) {
        scope.assert.throws(function validateFailedCollection() {
            validateFrozenFamilyCollection(collected, collected, [ {
                attributedToAttempt: null,
                attributedTo: null,
                cause: null,
                diagnostics: [],
                message: 'Collection failed.',
                subtype: 'loader'
            } ]);
        }, { message: 'Selected family collection did not return complete facts.' });
        return scope.assert.collect();
    }),
    test('rejects selected collection facts from a changed catalog', function (scope) {
        scope.assert.throws(function validateChangedCatalog() {
            validateFrozenFamilyCollection(collected, {
                ...collected,
                definition: { ...frozen, checkpoint: { preparation: collected.facts, catalog: 'changed' } }
            }, []);
        }, { message: 'Frozen family work changed; collect a new run.' });
        return scope.assert.collect();
    }),
    test('retains an explicit configuration source through command normalization', function (scope) {
        const source = {
            kind: 'config-file',
            request: { cwd: '/project', configPath: 'overkill.config.ts' },
            resolvedPath: '/project/overkill.config.ts'
        } as const;
        const snapshot = snapshotRunCommand({
            kind: 'configured',
            source,
            command: {
                cwd: '/project',
                engine: { kind: 'default' },
                request: defaultRunRequest({ profile: 'unit' }),
                config: normalizeConfig({
                    profiles: { unit: { testFamily: 'microtest', files: { include: [ 'unit.ts' ] } } }
                })
            }
        });
        scope.assert.equal(snapshot.source.kind, 'configured-source');
        scope.assert.equal(snapshot.command.request.profile, 'unit');
        return scope.assert.collect();
    }),
    test('rejects changed preparation evidence', function (scope) {
        const expected = {
            id: frozen.id,
            version: frozen.version,
            settings: null,
            preparation: { fingerprint: 'original' }
        };
        scope.assert.throws(function validateChangedPreparation() {
            assertFrozenFamilyPreparation(expected, { ...expected, preparation: { fingerprint: 'changed' } });
        }, { message: 'Frozen family preparation changed; collect a new run.' });
        return scope.assert.collect();
    }),
    test('resolves a named branded definition without loading its backend', async function (scope) {
        const family = definition('1');
        const binding = await resolveFrozenFamily(frozen, 'in-process', {
            async loadConfig() {
                throw new Error('Unexpected configuration load.');
            },
            async importModule() {
                return { family };
            }
        });
        scope.assert.equal(binding.testFamily, family);
        scope.assert.equal(binding.settings, null);
        return scope.assert.collect();
    }),
    ...[
        { name: 'a changed version', exported: definition('2'), processModel: 'in-process' },
        {
            name: 'a changed identity',
            exported: defineTestFamily({ ...definition('1'), id: '@example/changed' }),
            processModel: 'in-process'
        },
        {
            name: 'a factory export',
            exported() {
                return definition('1');
            },
            processModel: 'in-process'
        },
        { name: 'an unbranded export', exported: { id: frozen.id, version: '1' }, processModel: 'in-process' },
        { name: 'unsupported placement', exported: definition('1'), processModel: 'worker-pool' }
    ]
        .map(function invalidResolution(scenario) {
            return test(`rejects ${scenario.name}`, async function (scope) {
                await scope.assert.rejects(async function resolve() {
                    await resolveFrozenFamily(
                        frozen,
                        scenario.processModel === 'worker-pool' ? 'worker-pool' : 'in-process',
                        {
                            async loadConfig() {
                                throw new Error('Unexpected configuration load.');
                            },
                            async importModule() {
                                return { family: scenario.exported };
                            }
                        }
                    );
                }, { message: 'Failed to resolve the frozen test family.' });
                return scope.assert.collect();
            });
        }),
    test('rejects changed settings normalization before backend loading', async function (scope) {
        const original = definition('1');
        const family = defineTestFamily({
            id: original.id,
            version: original.version,
            module: null,
            features: original.features,
            parseSettings() {
                return { revision: 2 };
            },
            async load() {
                throw new Error('Resolution must not load the backend.');
            }
        });
        await scope.assert.rejects(async function resolveChangedSettings() {
            await resolveFrozenFamily({ ...frozen, settings: { revision: 1 } }, 'in-process', {
                async loadConfig() {
                    throw new Error('Unexpected configuration load.');
                },
                async importModule() {
                    return { family };
                }
            });
        }, { message: 'Failed to resolve the frozen test family.' });
        return scope.assert.collect();
    }),
    ...[
        { name: 'a null namespace', value: null },
        { name: 'a non-module namespace', value: 42 },
        { name: 'a missing named export', value: {} }
    ]
        .map(function malformedModule(scenario) {
            return test(`rejects ${scenario.name}`, async function (scope) {
                await scope.assert.rejects(async function resolveMalformedModule() {
                    await resolveFrozenFamily(frozen, 'in-process', {
                        async loadConfig() {
                            throw new Error('Unexpected configuration load.');
                        },
                        async importModule() {
                            return scenario.value;
                        }
                    });
                }, { message: 'Failed to resolve the frozen test family.' });
                return scope.assert.collect();
            });
        }),
    test('rejects a missing configuration profile without importing a replacement', async function (scope) {
        let imports = 0;
        await scope.assert.rejects(async function resolveMissingProfile() {
            await resolveFrozenFamily(
                { ...frozen, source: { kind: 'config-file', configPath: '/config.ts', profile: 'missing' } },
                'in-process',
                {
                    async loadConfig() {
                        return normalizeConfig({ profiles: { other: { testFamily: 'microtest' } } });
                    },
                    async importModule() {
                        imports += 1;
                        return { family: definition('1') };
                    }
                }
            );
        }, { message: 'Failed to resolve the frozen test family.' });
        scope.assert.equal(imports, 0);
        return scope.assert.collect();
    }),
    test('does not fall back to module resolution after configuration failure', async function (scope) {
        let imports = 0;
        await scope.assert.rejects(async function resolve() {
            await resolveFrozenFamily(
                { ...frozen, source: { kind: 'config-file', configPath: '/config.ts', profile: 'types' } },
                'in-process',
                {
                    async loadConfig() {
                        throw new Error('Configuration changed.');
                    },
                    async importModule() {
                        imports += 1;
                        return { family: definition('1') };
                    }
                }
            );
        }, { message: 'Failed to resolve the frozen test family.' });
        scope.assert.equal(imports, 0);
        return scope.assert.collect();
    }),
    test('resolves a local definition through its explicit configuration', async function (scope) {
        const family = definition('1');
        const config = normalizeConfig({
            profiles: {
                types: {
                    testFamily: family,
                    settings: null,
                    files: { include: [ 'types.ts' ] }
                }
            }
        });
        const binding = await resolveFrozenFamily(
            { ...frozen, source: { kind: 'config-file', configPath: '/config.ts', profile: 'types' } },
            'in-process',
            {
                async loadConfig() {
                    return config;
                },
                async importModule() {
                    throw new Error('Unexpected module load.');
                }
            }
        );
        scope.assert.equal(binding.testFamily, family);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
