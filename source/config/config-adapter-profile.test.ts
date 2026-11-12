import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineTestFamily } from '../packages/engine/engine.entry-point.ts';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { bindFamilySettings } from '../engine/test-family.ts';
import { normalizeConfig } from './config.ts';
import { projectConfigSchema } from './schema.ts';
import { copyConfig } from './snapshot.ts';
import { validateNormalizedConfig } from './validation.ts';
import { familySettings, isDefinedFamilyProfile, type NormalizedConfig, type DefinedFamilyProfile } from './types.ts';

const family = defineTestFamily({
    id: '@example/checker',
    version: '1',
    module: null,
    features: { execution: 'analysis', processModels: [ 'in-process' ], profileOptions: [] },
    parseSettings(input) {
        if (input !== 'accepted') {
            throw new TypeError('Unsupported checker settings.');
        }
        return input;
    },
    async load() {
        throw new Error('Configuration must not load the checker.');
    }
});
const definition = {
    testFamily: family,
    files: { include: [ 'source/**/*.types.ts' ] },
    settings: 'accepted'
} as const;
const reporter = createInMemoryRealTimeReporter();
const scenarios = [
    { name: 'default reporters', profile: definition },
    { name: 'explicit reporters', profile: { ...definition, reporters: [ reporter ] as const } }
];

function registeredProfile(config: NormalizedConfig): DefinedFamilyProfile {
    const profile = config.profiles.types;
    if (profile === undefined || !isDefinedFamilyProfile(profile)) {
        throw new Error('Missing family profile.');
    }
    return profile;
}
const unsupportedPolicies = Object.entries({ coverage: {}, retries: { maxAttempts: 2 }, attachments: {} });

export const testNode = suite('imported analysis profile configuration', [
    test('rejects missing, forged, and mismatched normalized settings bindings', function (scope) {
        const config = normalizeConfig({ profiles: { types: definition } });
        const profile = registeredProfile(config);
        const missing = { ...profile };
        Reflect.deleteProperty(missing, familySettings);
        for (
            const invalid of [
                missing,
                { ...profile, [familySettings]: { ...profile[familySettings] } },
                { ...profile, settings: 'different' },
                { ...profile, testFamily: defineTestFamily({ ...family, id: '@example/another-checker' }) }
            ]
        ) {
            scope.assert.throws(function validateUnboundSettings() {
                validateNormalizedConfig({ ...config, profiles: { ...config.profiles, types: invalid } });
            }, { message: 'Imported profile settings must be normalized with their family.' });
        }
        return scope.assert.collect();
    }),
    test('rejects unsupported normalized placement and analysis process measurement', function (scope) {
        const config = normalizeConfig({ profiles: { types: definition } });
        const profile = registeredProfile(config);
        scope.assert.throws(function validateHostPlacement() {
            validateNormalizedConfig({
                ...config,
                profiles: {
                    types: {
                        ...profile,
                        execution: { ...profile.execution, processModel: 'supervised-process' }
                    }
                }
            });
        }, { message: 'The selected family does not support the configured process model.' });
        scope.assert.throws(function validateRuntimeMeasurement() {
            validateNormalizedConfig({
                ...config,
                profiles: {
                    types: {
                        ...profile,
                        processUsage: { ...profile.processUsage, measure: true }
                    }
                }
            });
        }, { message: 'Analysis profiles do not support runtime process usage policy.' });
        return scope.assert.collect();
    }),
    test('validates normalized placement against the bound family capabilities', function (scope) {
        const config = normalizeConfig({ profiles: { types: definition } });
        const hosted = defineTestFamily({
            ...family,
            id: '@example/hosted-checker',
            features: { ...family.features, processModels: [ 'worker-pool' ] }
        });
        const binding = bindFamilySettings(hosted, 'accepted');
        scope.assert.throws(function validateUnsupportedPlacement() {
            validateNormalizedConfig({
                ...config,
                profiles: {
                    types: {
                        ...registeredProfile(config),
                        testFamily: hosted,
                        settings: binding.settings,
                        [familySettings]: binding
                    }
                }
            });
        }, { message: 'The selected family does not support the configured process model.' });
        return scope.assert.collect();
    }),
    test('retains runtime placement defaults and validates family capabilities', function (scope) {
        const runtime = defineTestFamily({
            ...family,
            id: '@example/runtime-placement',
            features: {
                execution: 'runtime',
                processModels: [ 'in-process', 'supervised-process' ],
                profileOptions: []
            }
        });
        const config = normalizeConfig({ profiles: { types: { ...definition, testFamily: runtime } } });
        scope.assert.equal(registeredProfile(config).execution.processModel, 'supervised-process');
        scope.assert.equal(registeredProfile(config).testFamily, runtime);
        const local = defineTestFamily({
            ...runtime,
            features: { ...runtime.features, processModels: [ 'in-process' ] }
        });
        scope.assert.throws(function normalizeUnsupportedDefaultPlacement() {
            normalizeConfig({ profiles: { types: { ...definition, testFamily: local } } });
        }, { message: 'The selected family does not support the configured process model.' });
        return scope.assert.collect();
    }),
    ...scenarios.flatMap(function (scenario) {
        return [
            test(`normalizes ${scenario.name} without loading`, function (scope) {
                const config = normalizeConfig({ profiles: { types: scenario.profile } });
                validateNormalizedConfig(config);
                const profile = registeredProfile(config);
                scope.assert.equal(profile.testFamily, family);
                scope.assert.equal(JSON.stringify(profile.settings), '"accepted"');
                scope.assert.deepEqual(profile.execution, {
                    processModel: 'in-process',
                    maxConcurrency: 1,
                    scheduling: 'serial'
                });
                scope.assert.deepEqual(profile.files, { include: [ 'source/**/*.types.ts' ], exclude: [] });
                scope.assert.deepEqual(profile.timeouts, {
                    collectionMilliseconds: 60_000,
                    softMilliseconds: 60_000,
                    hardMilliseconds: 60_000
                });
                return scope.assert.collect();
            }),
            test(`snapshots ${scenario.name} without replacing definitions`, function (scope) {
                const config = normalizeConfig({ profiles: { types: scenario.profile } });
                const copied = copyConfig(config);
                scope.assert.deepEqual(copied, config);
                scope.assert.equal(copied.profiles.types?.testFamily, family);
                scope.assert.notEqual(copied.profiles.types, config.profiles.types);
                scope.assert.notEqual(copied.profiles.types?.files, config.profiles.types?.files);
                return scope.assert.collect();
            })
        ];
    }),
    test('rejects unbranded definitions and bare optional family strings', function (scope) {
        for (const testFamily of [ undefined, null, 'type-test', {}, { ...family }, { ...family, load: null } ]) {
            scope.assert.throws(
                function () {
                    return projectConfigSchema.parse({ profiles: { types: { ...definition, testFamily } } });
                },
                { message: /testFamily/u }
            );
        }
        return scope.assert.collect();
    }),
    test('delegates settings validation before loading', function (scope) {
        scope.assert.throws(function () {
            return normalizeConfig({ profiles: { types: { ...definition, settings: 'rejected' } } });
        }, {
            message: 'Unsupported checker settings.'
        });
        return scope.assert.collect();
    }),
    test('rejects undeclared runtime policies', function (scope) {
        for (const [ field, value ] of unsupportedPolicies) {
            scope.assert.throws(
                function () {
                    return projectConfigSchema.parse({ profiles: { types: { ...definition, [field]: value } } });
                },
                { message: new RegExp(field, 'u') }
            );
        }
        return scope.assert.collect();
    }),
    test('retains explicit common timeout and evidence policy', function (scope) {
        const config = normalizeConfig({
            profiles: {
                types: {
                    ...definition,
                    timeouts: { collectionMilliseconds: 500, softMilliseconds: 100, hardMilliseconds: 200 },
                    runRecords: { persist: 'always' },
                    timings: { collection: 'precise' }
                }
            }
        });
        const profile = config.profiles.types;
        if (profile === undefined) {
            throw new Error('Missing family profile.');
        }
        scope.assert.deepEqual(profile.timeouts, {
            collectionMilliseconds: 500,
            softMilliseconds: 100,
            hardMilliseconds: 200
        });
        scope.assert.equal(config.profiles.types?.runRecords.persist, 'always');
        scope.assert.equal(config.profiles.types?.timings.collection, 'precise');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
