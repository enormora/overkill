import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createSingleConfigModuleLoader, configFixtureCwd } from '../test-support/run-config-module-loader.ts';
import { integrationProfileSchema, microtestProfileSchema } from './run-config-schema.ts';
import type { LoadedRunConfig } from './run-config.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
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

async function integrationConfig(retries: unknown): Promise<LoadedRunConfig> {
    const loadConfig = createSingleConfigModuleLoader('overkill.config.js', {
        config: { profiles: { service: { testFamily: 'integration', files, retries } } }
    });
    return await loadConfig({ configPath: null, cwd: configFixtureCwd });
}

export const testNode = createSuite({
    ...metadata,
    title: 'source/run/run-config-retries.test.ts',
    children: [
        ...invalidPolicies.map(function invalidPolicy(retries, index) {
            return createTestCase({
                ...metadata,
                title: `integration rejects invalid retry policy ${index}`,
                body(scope: TestScope) {
                    scope.assert.false(
                        integrationProfileSchema.safeParse({ testFamily: 'integration', files, retries }).success
                    );
                    return scope.assert.collect();
                }
            });
        }),
        ...[ 1, 3 ].map(function attemptLimit(maxAttempts) {
            return createTestCase({
                ...metadata,
                title: `integration normalizes ${maxAttempts} total attempts with default retention`,
                async body(scope: TestScope) {
                    const config = await integrationConfig({ maxAttempts });
                    const profile = config.profiles.service;
                    scope.require.defined(profile);
                    if (profile.testFamily !== 'integration') {
                        throw new Error('Expected an integration profile.');
                    }
                    scope.require.defined(profile.retries);
                    scope.assert.deepEqual(profile.retries, { maxAttempts, artifacts: 'first-failure-and-final' });
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...metadata,
            title: 'microtest profiles reject the integration retry policy',
            body(scope: TestScope) {
                scope.assert.false(
                    microtestProfileSchema.safeParse({ testFamily: 'microtest', retries: { maxAttempts: 3 } }).success
                );
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
