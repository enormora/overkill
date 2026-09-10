import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    configFixtureCwd,
    createSingleConfigModuleLoader
} from '../test-support/run-config-module-loader.ts';

async function loadConfigValue(config: unknown): Promise<unknown> {
    const loadRunConfig = createSingleConfigModuleLoader('overkill.config.js', { config });

    return await loadRunConfig({ configPath: null, cwd: configFixtureCwd });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-timeouts.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects profile soft timeouts greater than hard timeouts',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
