import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
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
import type { LoadedRunConfig } from './run-config.ts';

function createReporter(name: string): FixedDefinedReporter {
    return defineFixedReporter({
        dispose: null,
        kind: 'real-time',
        name,
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    });
}

async function loadReporterConfig(): Promise<LoadedRunConfig> {
    const loadRunConfig = createSingleConfigModuleLoader('overkill.config.js', {
        config: {
            reporters: [ createReporter('global') ],
            profiles: {
                microtest: {
                    testFamily: 'microtest',
                    reporters: [ createReporter('profile') ]
                }
            }
        }
    });

    return await loadRunConfig({ configPath: null, cwd: configFixtureCwd });
}

async function loadConfigValue(config: unknown): Promise<LoadedRunConfig> {
    const loadRunConfig = createSingleConfigModuleLoader('overkill.config.js', { config });

    return await loadRunConfig({ configPath: null, cwd: configFixtureCwd });
}

function reporterNames(scope: OverkillScope, config: LoadedRunConfig): readonly [string, string] {
    const globalReporters = config.reporters;
    const profileReporters = config.profiles.microtest?.reporters;

    scope.require.defined(globalReporters);
    scope.require.defined(profileReporters);
    const globalReporter = globalReporters[0];
    const profileReporter = profileReporters[0];

    scope.require.defined(globalReporter);
    scope.require.defined(profileReporter);
    const context = createReportingContext({ projectRoot: null });

    return [ globalReporter(context).name, profileReporter(context).name ];
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-reporters.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() preserves global reporter fallback and profile reporter overrides',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                scope.assert.deepEqual(reporterNames(scope, await loadReporterConfig()), [ 'global', 'profile' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects an explicit empty reporter list',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({ reporters: [] });
                }, {
                    message: /at reporters\[0\]/
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
