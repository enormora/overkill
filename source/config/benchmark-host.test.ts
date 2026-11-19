import { defaultIntegrationProfile } from '../test-support/run-command-factory.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { projectConfigSchema } from './schema.ts';
import { normalizeConfig } from './config.ts';
import { copyConfig } from './snapshot.ts';
import type { NormalizedConfig } from './types.ts';
import { validateNormalizedConfig } from './validation.ts';
import { benchmarkHostLimitsSchema } from './benchmark-host.ts';

function hostConfig(): NormalizedConfig {
    return normalizeConfig({
        profiles: {
            startup: {
                testFamily: 'benchmark',
                files: { include: [ 'sample.bench.ts' ] },
                host: { limits: { maximumCpuBusyPercent: 80, minimumAvailableMemoryPercent: 10 } }
            }
        }
    });
}

export const testNode = suite('benchmark host configuration', [
    ...([ 'supervised-process', 'worker-pool' ] as const).map(function (processModel) {
        return test(`copies integration placement ${processModel}`, function (scope: TestScope) {
            const original = {
                ...hostConfig(),
                profiles: {
                    sample: defaultIntegrationProfile({
                        execution: { processModel, hostProcess: { kind: 'child', nodeArguments: [ '--no-warnings' ] } }
                    })
                }
            };
            const copied = copyConfig(original);
            scope.assert.deepEqual(copied, original);
            scope.assert.notEqual(copied.profiles.sample?.execution, original.profiles.sample.execution);
            return scope.assert.collect();
        });
    }),
    test('copies supervised benchmark placement independently', function (scope: TestScope) {
        const original = normalizeConfig({
            profiles: {
                sample: {
                    testFamily: 'benchmark',
                    files: { include: [ 'sample.bench.ts' ] },
                    execution: { processModel: 'supervised-process' }
                }
            }
        });
        const copied = copyConfig(original);
        scope.assert.deepEqual(copied, original);
        scope.assert.notEqual(copied.profiles.sample?.execution, original.profiles.sample?.execution);
        return scope.assert.collect();
    }),
    test('requires every limit in direct normalized configuration', function (scope: TestScope) {
        const config = copyConfig(hostConfig());
        const profile = config.profiles.startup;
        if (profile?.testFamily !== 'benchmark') {
            throw new Error('Missing benchmark profile.');
        }
        scope.assert.true(Reflect.deleteProperty(profile.host.limits, 'maximumCpuBusyPercent'));
        scope.assert.throws(function () {
            validateNormalizedConfig(config);
        }, { name: 'ConfigError' });
        return scope.assert.collect();
    }),
    test('normalizes relative limits and leaves omitted checks disabled', function (scope: TestScope) {
        const profile = hostConfig().profiles.startup;
        if (profile?.testFamily !== 'benchmark') {
            throw new Error('Missing benchmark profile.');
        }
        scope.assert.equal(profile.host.limits.maximumCpuBusyPercent, 80);
        scope.assert.equal(profile.host.limits.minimumAvailableMemoryPercent, 10);
        scope.assert.equal(profile.host.limits.maximumLinuxCpuStallPercent, null);
        return scope.assert.collect();
    }),
    test('copies host policy independently when snapshotting configuration', function (scope: TestScope) {
        const config = hostConfig();
        const profile = config.profiles.startup;
        const copied = copyConfig(config).profiles.startup;
        if (profile?.testFamily !== 'benchmark' || copied?.testFamily !== 'benchmark') {
            throw new Error('Missing benchmark profile.');
        }
        scope.assert.notEqual(copied.host.limits, profile.host.limits);
        scope.assert.deepEqual(copied.host, profile.host);
        return scope.assert.collect();
    }),
    test('rejects invalid direct normalized policy', function (scope: TestScope) {
        const config = hostConfig();
        const profile = config.profiles.startup;
        if (profile?.testFamily !== 'benchmark') {
            throw new Error('Missing benchmark profile.');
        }
        scope.assert.throws(function () {
            validateNormalizedConfig({
                ...config,
                profiles: {
                    startup: { ...profile, host: { limits: { ...profile.host.limits, maximumCpuBusyPercent: 101 } } }
                }
            });
        }, { name: 'ConfigError' });
        return scope.assert.collect();
    }),
    test(
        'rejects nonfinite or out-of-range limits, unknown keys, and host policy on ordinary profiles',
        function (scope: TestScope) {
            for (
                const limits of [ { minimumAvailableMemoryPercent: -1 }, {
                    maximumCpuBusyPercent: Number.POSITIVE_INFINITY
                }, { unknown: 1 } ]
            ) {
                scope.assert.throws(function () {
                    return benchmarkHostLimitsSchema.parse(limits);
                }, { name: 'ZodError' });
            }
            scope.assert.throws(
                function () {
                    return projectConfigSchema.parse({ profiles: { ordinary: { testFamily: 'microtest', host: {} } } });
                },
                { name: 'ZodError' }
            );
            return scope.assert.collect();
        }
    )
]);
