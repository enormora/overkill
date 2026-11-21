import { suite, test } from '@overkill-dev/test';

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

function reporterNames(config: LoadedConfig): readonly [string, string] {
    const globalReporters = config.reporters;
    const profileReporters = selectTestProfile('microtest', config).reporters;

    if (globalReporters === undefined || globalReporters === null) {
        throw new Error('Expected globalReporters to satisfy defined.');
    }
    if (profileReporters === undefined || profileReporters === null) {
        throw new Error('Expected profileReporters to satisfy defined.');
    }
    const globalReporter = globalReporters[0];
    const profileReporter = profileReporters[0];

    if (globalReporter === undefined || globalReporter === null) {
        throw new Error('Expected globalReporter to satisfy defined.');
    }
    if (profileReporter === undefined || profileReporter === null) {
        throw new Error('Expected profileReporter to satisfy defined.');
    }
    const context = createReportingContext({ projectRoot: null });

    return [ globalReporter(context).name, profileReporter(context).name ];
}

export const testNode = suite('Configuration reporters', [
    test(
        'loadConfig() preserves global reporter fallback and profile reporter overrides',
        async function (scope) {
            scope.assert.deepEqual(reporterNames(await loadReporterConfig()), [ 'global', 'profile' ]);

            return scope.assert.collect();
        }
    ),
    test('loadConfig() rejects an explicit empty reporter list', async function (scope) {
        await scope.assert.rejects(async function loadInvalidConfig() {
            await loadConfigValue({ reporters: [] });
        }, {
            message: /at reporters\[0\]/
        });

        return scope.assert.collect();
    })
]);
