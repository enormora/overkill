import { runIfMain } from '#test-runner';
import { suite, test, testDouble, type TestScope } from '../packages/test/test.entry-point.ts';
import { frozenPolicyValidation } from '../test-support/frozen-policy-validation.ts';
import { ConfigError } from '../packages/run/config.entry-point.ts';
import { testNode as origins } from './frozen-policy-origins.test.ts';
import { revalidateFrozenPolicy } from './frozen-policy-validation.ts';

export const testNode = suite('frozen policy source validation', [
    origins,
    test('accepts identical configured discovery and execution facts', async function (scope: TestScope) {
        const fixture = await frozenPolicyValidation();
        await revalidateFrozenPolicy(fixture.policy, fixture.dependencies, fixture.load);
        scope.assert.deepEqual(fixture.events, [ 'load', 'discover' ]);
        return scope.assert.collect();
    }),
    test('does not reload an in-memory policy', async function (scope: TestScope) {
        const fixture = await frozenPolicyValidation();
        await revalidateFrozenPolicy(
            { ...fixture.policy, source: { kind: 'memory' } },
            fixture.dependencies,
            fixture.load
        );
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('rejects changed runtime state storage', async function (scope: TestScope) {
        const fixture = await frozenPolicyValidation();
        await scope.assert.rejects(async function () {
            await revalidateFrozenPolicy(fixture.policy, fixture.dependencies, async function () {
                return {
                    ...await fixture.load({ cwd: '/project', configPath: 'overkill.config.js' }),
                    runtimeStateDir: '.changed'
                };
            });
        }, { message: 'Frozen policy changed: runtimeStateDir.' });
        return scope.assert.collect();
    }),
    test('rejects discovery outside the frozen project root', async function (scope: TestScope) {
        const fixture = await frozenPolicyValidation();
        await scope.assert.rejects(async function () {
            await revalidateFrozenPolicy(fixture.policy, {
                async discoverRunFilesWithProjectRoot() {
                    return { projectRoot: '/changed', files: fixture.policy.files };
                }
            }, fixture.load);
        }, {
            message:
                'Frozen policy revalidation failed: RunResolutionError: Invalid frozen discovery descriptor: source/integration-tests/run/fixtures/passing.test.ts'
        });
        return scope.assert.collect();
    }),
    test('preserves nested configuration failure details', async function (scope: TestScope) {
        const fixture = await frozenPolicyValidation();
        const failure = new ConfigError('invalid config', { cause: new Error('invalid profile') });
        await scope.assert.rejects(async function () {
            await revalidateFrozenPolicy(fixture.policy, fixture.dependencies, async function () {
                throw failure;
            });
        }, {
            message: 'Frozen policy revalidation failed: ConfigError: invalid config: Error: invalid profile',
            cause: { exact: failure }
        });
        return scope.assert.collect();
    }),
    test('wraps non-Error loading failures', async function (scope: TestScope) {
        const fixture = await frozenPolicyValidation();
        await scope.assert.rejects(async function () {
            await revalidateFrozenPolicy(
                fixture.policy,
                fixture.dependencies,
                testDouble.rejects<typeof fixture.load>('invalid config')
            );
        }, { message: 'Frozen policy revalidation failed: invalid config', cause: { exact: 'invalid config' } });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
