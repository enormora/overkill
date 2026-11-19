import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { configFixtureCwd, createSingleConfigModuleLoader } from '../test-support/run-config-module-loader.ts';

async function loadConfigValue(config: unknown): Promise<unknown> {
    const loadConfig = createSingleConfigModuleLoader('overkill.config.js', { config });

    return await loadConfig({ configPath: null, cwd: configFixtureCwd });
}

export const testNode = suite('source/config/config-timeouts.test.ts', [
    test(
        'loadConfig() rejects profile soft timeouts greater than hard timeouts',
        async function (scope: OverkillScope) {
            await scope.assert.rejects(async function loadInvalidConfig() {
                await loadConfigValue({
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            timeouts: {
                                hardMilliseconds: 100,
                                softMilliseconds: 200
                            }
                        }
                    }
                });
            }, {
                message: /softMilliseconds must be less than or equal to hardMilliseconds/
            });

            return scope.assert.collect();
        }
    )
]);
