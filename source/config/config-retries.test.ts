import { suite, table, test, type ParameterizedTestScope } from '@overkill-dev/test';

import { createSingleConfigModuleLoader, configFixtureCwd } from '../test-support/run-config-module-loader.ts';
import { integrationProfileSchema, microtestProfileSchema } from './schema.ts';
import type { LoadedConfig } from './config-loader.ts';

const files = { include: [ 'source/**/*.integration.test.ts' ] };
const invalidPolicies: readonly unknown[] = [
    { maxAttempts: 0 },
    { maxAttempts: -1 },
    { maxAttempts: 1.5 },
    { maxAttempts: Number.MAX_SAFE_INTEGER + 1 },
    { maxAttempts: Number.NaN },
    { maxAttempts: Number.POSITIVE_INFINITY },
    { maxAttempts: 3, artifacts: 'unknown' },
    { maxAttempts: 3, delay: 1 },
    { attempts: 3 },
    null
];

async function integrationConfig(retries: unknown): Promise<LoadedConfig> {
    const loadConfig = createSingleConfigModuleLoader('overkill.config.js', {
        config: { profiles: { service: { testFamily: 'integration', files, retries } } }
    });
    return await loadConfig({ configPath: null, cwd: configFixtureCwd });
}

export const testNode = suite('source/config/config-retries.test.ts', [
    table({
        title: 'integration rejects invalid retry policies',
        cases: invalidPolicies,
        caseTitle(_policy, index) {
            return `invalid policy ${index}`;
        },
        test(scope) {
            scope.assert.false(
                integrationProfileSchema
                    .safeParse({
                        testFamily: 'integration',
                        files,
                        retries: scope.parameters
                    })
                    .success
            );
            return scope.assert.collect();
        }
    }),
    table({
        title: 'integration normalizes total attempts with default retention',
        cases: [ 1, 3 ],
        caseTitle(maxAttempts) {
            return `${maxAttempts} attempts`;
        },
        async test(scope: ParameterizedTestScope<number>) {
            const maxAttempts = scope.parameters;
            const config = await integrationConfig({ maxAttempts });
            const profile = config.profiles.service;
            scope.require.defined(profile);
            if (profile.testFamily !== 'integration') {
                throw new Error('Expected an integration profile.');
            }
            scope.assert.deepEqual<unknown, unknown>(profile.retries, {
                maxAttempts,
                artifacts: 'first-failure-and-final'
            });
            return scope.assert.collect();
        }
    }),
    test('microtest profiles reject the integration retry policy', function (scope) {
        scope.assert.false(
            microtestProfileSchema.safeParse({ testFamily: 'microtest', retries: { maxAttempts: 3 } }).success
        );
        return scope.assert.collect();
    })
]);
