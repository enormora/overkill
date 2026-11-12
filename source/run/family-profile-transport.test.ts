import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineTestFamily, type FamilyModuleReference } from '../packages/engine/engine.entry-point.ts';
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

export const testNode = suite('family transport provenance', [
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
