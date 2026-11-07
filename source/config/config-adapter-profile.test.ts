import { orchestrator } from '../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import type { RunAdapterRegistration } from './adapter-profile.ts';
import { normalizeConfig } from './config.ts';
import { projectConfigSchema } from './schema.ts';
import { copyConfig } from './snapshot.ts';
import { validateNormalizedConfig } from './validation.ts';
import type { AdapterProfileConfig, NormalizedConfig } from './types.ts';

const adapter: RunAdapterRegistration = {
    id: 'fixture',
    validate(settings) {
        if (settings !== 'accepted') {
            throw new Error('Unsupported checker settings.');
        }
    },
    async load() {
        throw new Error('Configuration must not load the checker.');
    }
};
const definition = {
    testFamily: 'type-test',
    files: { include: [ 'source/**/*.types.ts' ] },
    adapter,
    settings: 'accepted'
} as const;

function registeredProfile(config: NormalizedConfig): AdapterProfileConfig {
    const profile = config.profiles.types;
    if (profile?.testFamily !== 'type-test') {
        throw new Error('Expected a registered adapter profile.');
    }
    return profile;
}

const reporter = createInMemoryRealTimeReporter();
const profileScenarios = [
    { name: 'default reporter selection', profile: definition },
    { name: 'explicit reporters', profile: { ...definition, reporters: [ reporter ] as const } }
];
const unsupportedRuntimeSettings = Object.entries({
    execution: { processModel: 'worker-pool' },
    coverage: { outputs: [ 'lcov' ] },
    processUsage: { measure: true },
    retries: { maxAttempts: 2 },
    timeouts: { softMilliseconds: 1 }
});

export const testNode = suite('adapter profile configuration', [
    test('rejects ordinary baseline commands for checker profiles', async function (scope) {
        const config = normalizeConfig({ profiles: { types: definition } });
        const command = {
            config,
            cwd: process.cwd(),
            engine: { kind: 'default' as const },
            request: defaultRunRequest({ profile: 'types' })
        };
        const error = { message: 'Ordinary baselines require a microtest, property, or integration profile.' };
        await scope.assert.rejects(async function () {
            await orchestrator.baseline.list({ ...command, request: { profile: 'types', paths: [] } });
        }, error);
        await scope.assert.rejects(async function () {
            await orchestrator.baseline.update(command, { timing: null });
        }, error);
        return scope.assert.collect();
    }),
    ...profileScenarios.flatMap(function (scenario) {
        return [
            test(`normalizes ${scenario.name} without loading the checker`, function (scope) {
                const config = normalizeConfig({ profiles: { types: scenario.profile } });
                validateNormalizedConfig(config);
                const profile = registeredProfile(config);
                scope.assert.equal(profile.adapter, adapter);
                scope.assert.equal(profile.settings, 'accepted');
                scope.assert.deepEqual(profile.execution, {
                    processModel: 'in-process',
                    maxConcurrency: 1,
                    scheduling: 'serial'
                });
                scope.assert.deepEqual(profile.files, { include: [ 'source/**/*.types.ts' ], exclude: [] });
                return scope.assert.collect();
            }),
            test(`snapshots ${scenario.name} while retaining registration and isolating policies`, function (scope) {
                const config = normalizeConfig({ profiles: { types: scenario.profile } });
                const snapshot = copyConfig(config);
                const profile = registeredProfile(config);
                const copied = registeredProfile(snapshot);
                scope.assert.deepEqual(snapshot, config);
                scope.assert.equal(copied.adapter, adapter);
                scope.assert.notEqual(copied, profile);
                scope.assert.notEqual(copied.files, profile.files);
                scope.assert.notEqual(copied.execution, profile.execution);
                return scope.assert.collect();
            })
        ];
    }),
    test('rejects missing and malformed registrations with actionable diagnostics', function (scope) {
        const registrations: readonly unknown[] = [
            undefined,
            null,
            'fixture',
            {},
            { ...adapter, id: 0 },
            { ...adapter, validate: null },
            { ...adapter, load: null }
        ];
        for (const registration of registrations) {
            scope.assert.throws(function () {
                projectConfigSchema.parse({ profiles: { types: { ...definition, adapter: registration } } });
            }, { message: /Attach a type-test adapter explicitly/u });
        }
        return scope.assert.collect();
    }),
    test('delegates settings validation to the registered adapter', function (scope) {
        scope.assert.throws(function () {
            normalizeConfig({ profiles: { types: { ...definition, settings: 'rejected' } } });
        }, { message: 'Unsupported checker settings.' });
        return scope.assert.collect();
    }),
    test('rejects runtime execution settings instead of admitting them to static profiles', function (scope) {
        for (const [ field, value ] of unsupportedRuntimeSettings) {
            scope.assert.throws(function () {
                projectConfigSchema.parse({ profiles: { types: { ...definition, [field]: value } } });
            }, { message: new RegExp(field, 'u') });
        }
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
