import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineTestFamily } from '../packages/engine/engine.entry-point.ts';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { normalizeConfig } from './config.ts';
import { projectConfigSchema } from './schema.ts';
import { copyConfig } from './snapshot.ts';
import { validateNormalizedConfig } from './validation.ts';
import { isDefinedFamilyProfile, type NormalizedConfig, type DefinedFamilyProfile } from './types.ts';

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
