import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    type DefinedOutputRenderer,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import {
    defineFixedReporter,
    type FixedDefinedReporter
} from '../test-support/reporter-definition.ts';
import {
    configFixtureCwd,
    createSingleConfigModuleLoader
} from '../test-support/run-config-module-loader.ts';
import type {
    LoadedConfig,
    ConfigLoader
} from './config.ts';
import { ConfigError } from './config-error.ts';

const configFileName = 'overkill.config.js';

type UnbrandedOutputIntent = {
    readonly text: string;
};

function outputRenderer(): DefinedOutputRenderer {
    return defineOutputRenderer(function createOutputRenderer() {
        return {
            render(intent) {
                return `rendered ${intent.text}`;
            }
        };
    });
}

function reporter(): FixedDefinedReporter {
    return defineFixedReporter({
        dispose: null,
        kind: 'real-time',
        name: 'configured-memory',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    });
}

async function loadModule(module: unknown): Promise<LoadedConfig> {
    const loadConfig: ConfigLoader = createSingleConfigModuleLoader(configFileName, module);

    return await loadConfig({ configPath: null, cwd: configFixtureCwd });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/config/config-exports.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() accepts branded reporter and output renderer values',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadModule({
                    config: {
                        outputRenderer: outputRenderer(),
                        reporters: [ reporter() ]
                    }
                });
                const context = createReportingContext({ projectRoot: null });

                scope.require.defined(config.reporters);
                scope.assert.equal(
                    config.outputRenderer(context).render({
                        annotation: null,
                        kind: 'stdout-line',
                        role: 'primary',
                        text: 'line'
                    }),
                    'rendered line'
                );
                const configuredReporter = config.reporters[0];
                scope.require.defined(configuredReporter);
                scope.assert.equal(configuredReporter(context).name, 'configured-memory');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() rejects unbranded reporter values',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadModule({
                        config: {
                            reporters: [
                                {
                                    dispose: null,
                                    kind: 'real-time',
                                    name: 'unbranded',
                                    onEvent() {
                                        return undefined;
                                    },
                                    onFinish: null,
                                    sinks: [ { kind: 'memory' } ]
                                }
                            ]
                        }
                    });
                }, {
                    message: /defineReporter/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() rejects unbranded output renderer values',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadModule({
                        config: {
                            outputRenderer: {
                                render(intent: UnbrandedOutputIntent) {
                                    return intent.text;
                                }
                            }
                        }
                    });
                }, {
                    message: /defineOutputRenderer/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() rejects config files without a named config export',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadModule({ projectConfig: {} });
                }, {
                    type: ConfigError,
                    message: /must export a named config value/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() rejects config files with a default export',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadModule({ default: {} });
                }, {
                    type: ConfigError,
                    message: /must not export a default config/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() rejects config files with named config and default exports',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadModule({ config: {}, default: {} });
                }, {
                    type: ConfigError,
                    message: /must not export a default config/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() rejects config files with extra runtime exports',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadModule({ config: {}, extra: {} });
                }, {
                    type: ConfigError,
                    message: /must only export a named config value/
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
