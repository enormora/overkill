import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { selectTestProfile } from '../run/test-profile.ts';

import { createReportingContext } from '../engine/reporting-context.ts';
import { defineFixedReporter, type FixedDefinedReporter } from '../test-support/reporter-definition.ts';
import { configFixtureCwd, createSingleConfigModuleLoader } from '../test-support/run-config-module-loader.ts';
import type { LoadedConfig } from './config-loader.ts';

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

async function loadReporterConfig(): Promise<LoadedConfig> {
    const loadConfig = createSingleConfigModuleLoader('overkill.config.js', {
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

    return await loadConfig({ configPath: null, cwd: configFixtureCwd });
}

async function loadConfigValue(config: unknown): Promise<LoadedConfig> {
    const loadConfig = createSingleConfigModuleLoader('overkill.config.js', { config });

    return await loadConfig({ configPath: null, cwd: configFixtureCwd });
}

function reporterNames(scope: OverkillScope, config: LoadedConfig): readonly [string, string] {
    const globalReporters = config.reporters;
    const profileReporters = selectTestProfile('microtest', config).reporters;

    scope.require.defined(globalReporters);
    scope.require.defined(profileReporters);
    const globalReporter = globalReporters[0];
    const profileReporter = profileReporters[0];

    scope.require.defined(globalReporter);
    scope.require.defined(profileReporter);
    const context = createReportingContext({ projectRoot: null });

    return [ globalReporter(context).name, profileReporter(context).name ];
}

export const testNode = suite('source/config/config-reporters.test.ts', [
    test(
        'loadConfig() preserves global reporter fallback and profile reporter overrides',
        async function (scope: OverkillScope) {
            scope.assert.deepEqual(reporterNames(scope, await loadReporterConfig()), [ 'global', 'profile' ]);

            return scope.assert.collect();
        }
    ),
    test('loadConfig() rejects an explicit empty reporter list', async function (scope: OverkillScope) {
        await scope.assert.rejects(async function loadInvalidConfig() {
            await loadConfigValue({ reporters: [] });
        }, {
            message: /at reporters\[0\]/
        });

        return scope.assert.collect();
    })
]);
