import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createSuite, defineTestFamily, type FamilyModuleReference } from '../packages/engine/engine.entry-point.ts';
import { normalizeConfig } from '../packages/run/run.entry-point.ts';
import { freezeProfileFamily } from './family-profile-transport.ts';
import type { FrozenFamilyDefinition } from './family-catalog.ts';
import type { RunCollectionSource } from './run-types.ts';

const moduleReference = { moduleUrl: 'file:///project/family.ts', exportName: 'family' };
const configuredSource: RunCollectionSource = {
    kind: 'configured-source',
    source: {
        kind: 'config-file',
        request: { cwd: '/project', configPath: '/project/config.ts' },
        resolvedPath: '/project/config.ts'
    }
};

function transport(module: FamilyModuleReference | null, source: RunCollectionSource): FrozenFamilyDefinition {
    const family = defineTestFamily({
        id: '@example/transport',
        version: '1',
        module,
        features: { execution: 'analysis', processModels: [ 'worker-pool' ], profileOptions: [] },
        parseSettings() {
            return null;
        },
        async load() {
            throw new Error('Transport must not load the backend.');
        }
    });
    const config = normalizeConfig({
        profiles: {
            analysis: {
                testFamily: family,
                settings: null,
                files: { include: [ 'cases.ts' ] },
                execution: { processModel: 'worker-pool', scheduling: 'serial' }
            }
        }
    });
    const profile = config.profiles.analysis;
    if (profile === undefined) {
        throw new Error('Missing analysis profile.');
    }
    const frozen = freezeProfileFamily({
        profile,
        source,
        profileName: 'analysis',
        projectRoot: '/project',
        definitionLocationCapture: 'disabled'
    });
    if (frozen === null) {
        throw new Error('Missing frozen family definition.');
    }
    return frozen;
}

function recordedSource(definition: FrozenFamilyDefinition | null): RunCollectionSource {
    return {
        kind: 'replay',
        replay: {
            kind: 'record',
            witness: null,
            plan: {
                defined: 0,
                discoveredFiles: [],
                files: [],
                orphans: [],
                root: {
                    title: 'recorded',
                    annotations: { ownership: [], tags: [] },
                    controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null }
                },
                family: definition === null ? null : {
                    definition,
                    facts: {
                        id: definition.id,
                        version: definition.version,
                        settings: definition.settings,
                        preparation: null,
                        collection: null
                    }
                }
            }
        }
    };
}

export const testNode = suite('family transport provenance', [
    test('retains explicit configuration for direct entrypoints', function (scope) {
        scope.assert.deepEqual(
            transport(moduleReference, {
                kind: 'direct-entrypoint',
                configuration: configuredSource.source,
                root: { title: 'direct', annotations: {}, controls: {} },
                testNode: createSuite({
                    title: 'empty',
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    children: []
                })
            })
                .source,
            { kind: 'config-file', configPath: '/project/config.ts', profile: 'analysis' }
        );
        return scope.assert.collect();
    }),
    test('falls back to the named module when configuration has no resolved file', function (scope) {
        scope.assert.equal(
            transport(moduleReference, {
                kind: 'configured-source',
                source: { kind: 'config-file', request: { cwd: '/project', configPath: null }, resolvedPath: null }
            })
                .source
                .kind,
            'module'
        );
        return scope.assert.collect();
    }),
    test('falls back to the named module for records without family provenance', function (scope) {
        scope.assert.equal(transport(moduleReference, recordedSource(null)).source.kind, 'module');
        return scope.assert.collect();
    }),
    test('retains recorded configuration provenance while rebasing the project root', function (scope) {
        const previous = transport(moduleReference, configuredSource);
        const restored = transport(null, recordedSource({ ...previous, projectRoot: '/old-project' }));
        scope.assert.deepEqual(restored.source, previous.source);
        scope.assert.equal(restored.projectRoot, '/project');
        scope.assert.equal(restored.selection, null);
        return scope.assert.collect();
    }),
    ...[
        { name: 'identity', change: { id: '@example/changed' } },
        { name: 'version', change: { version: '2' } },
        { name: 'settings', change: { settings: { changed: true } } }
    ]
        .map(function changedRecordedDefinition(scenario) {
            return test(`rejects changed recorded ${scenario.name} before backend loading`, function (scope) {
                const previous = transport(moduleReference, configuredSource);
                scope.assert.throws(function freezeChangedRecord() {
                    transport(moduleReference, recordedSource({ ...previous, ...scenario.change }));
                }, { message: 'Recorded family implementation or settings changed; collect a new run.' });
                return scope.assert.collect();
            });
        }),
    test('prefers explicit configuration over the definition module', function (scope) {
        scope.assert.deepEqual(transport(moduleReference, configuredSource).source, {
            kind: 'config-file',
            configPath: '/project/config.ts',
            profile: 'analysis'
        });
        return scope.assert.collect();
    }),
    test('transports definitions without a module through explicit configuration', function (scope) {
        scope.assert.equal(transport(null, configuredSource).processModel, 'worker-pool');
        return scope.assert.collect();
    }),
    test('uses the named module when no configuration can be replayed', function (scope) {
        scope.assert.deepEqual(transport(moduleReference, { kind: 'configured-files' }).source, {
            kind: 'module',
            module: moduleReference
        });
        return scope.assert.collect();
    }),
    test('rejects local-only definitions before backend loading', function (scope) {
        scope.assert.throws(function isolateLocalDefinition() {
            transport(null, { kind: 'configured-files' });
        }, { message: 'The selected family has no importable configuration or module for isolated execution.' });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
