import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { ConfigError, defineConfig, normalizeConfig } from '../packages/run/config.entry-point.ts';
import { createSingleConfigModuleLoader, configFixtureCwd } from '../test-support/run-config-module-loader.ts';

const benchmarkPolicy = {
    baselines: { adapters: [], directory: 'test-baselines' },
    attachments: {
        maxInlineBytes: 1_048_576,
        maxArtifactBytes: 10_485_760,
        maxScopeBytes: 10_485_760,
        maxScopeAttachments: 100
    },
    execution: {
        processModel: 'worker-pool',
        scheduling: 'serial',
        maxConcurrency: 1,
        maxWorkers: null,
        assignmentPolicy: 'case-count-balanced',
        dispatchPolicy: 'dynamic-lease',
        hedging: { mode: 'off' },
        hostProcess: { kind: 'direct' },
        workDistribution: { mode: 'file' },
        workerLifecycle: 'reuse'
    },
    reporters: null,
    resourceUsage: {
        measure: false,
        samplingIntervalMilliseconds: 100,
        budgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        }
    },
    timings: { collection: 'summary' },
    timeouts: { collectionMilliseconds: 5000, hardMilliseconds: 60_000, softMilliseconds: 40_000 }
} as const;

const benchmarkFiles = { include: [ 'source/startup.bench.ts' ] } as const;

export const testNode = suite('benchmark profile configuration', [
    test(
        'normalizes mixed families and multiple benchmark profiles without changing authored policy',
        function (scope: TestScope) {
            const authored = {
                profiles: {
                    unit: { testFamily: 'microtest' },
                    service: { testFamily: 'integration', files: { include: [ 'source/service.test.ts' ] } },
                    startup: { testFamily: 'benchmark', files: benchmarkFiles },
                    benchmark: { testFamily: 'benchmark', files: { sets: { cold: benchmarkFiles } } }
                }
            } as const;
            const normalized = normalizeConfig(defineConfig(authored));

            scope.require.defined(normalized.profiles.startup);
            scope.require.defined(normalized.profiles.benchmark);
            scope.assert.deepEqual(
                normalized.profiles.startup,
                {
                    ...benchmarkPolicy,
                    testFamily: 'benchmark',
                    files: { include: [ 'source/startup.bench.ts' ], exclude: [] }
                } as const
            );
            scope.assert.deepEqual(
                normalized.profiles.benchmark,
                {
                    ...benchmarkPolicy,
                    testFamily: 'benchmark',
                    files: { sets: { cold: { include: [ 'source/startup.bench.ts' ], exclude: [] } } }
                } as const
            );
            scope.assert.deepEqual({
                unit: normalized.profiles.unit?.testFamily,
                service: normalized.profiles.service?.testFamily,
                microtest: normalized.profiles.microtest?.testFamily
            }, { unit: 'microtest', service: 'integration', microtest: 'microtest' } as const);
            scope.assert.deepEqual({
                reporters: normalized.reporters,
                hasConfigPath: Object.hasOwn(normalized, 'configPath')
            }, { reporters: null, hasConfigPath: false });
            scope.assert.deepEqual(
                authored.profiles.startup.files,
                { include: [ 'source/startup.bench.ts' ] } as const
            );
            return scope.assert.collect();
        }
    ),
    test('loads benchmark profiles from both supported project module formats', async function (scope: TestScope) {
        for (const name of [ 'overkill.config.ts', 'overkill.config.js' ]) {
            const load = createSingleConfigModuleLoader(name, {
                config: defineConfig({ profiles: { startup: { testFamily: 'benchmark', files: benchmarkFiles } } })
            });
            const loaded = await load({ configPath: null, cwd: configFixtureCwd });
            scope.require.defined(loaded.profiles.startup);
            scope.assert.deepEqual(
                loaded.profiles.startup,
                {
                    ...benchmarkPolicy,
                    testFamily: 'benchmark',
                    files: { include: [ 'source/startup.bench.ts' ], exclude: [] }
                } as const
            );
            scope.assert.equal(loaded.profiles.microtest?.testFamily, 'microtest');
        }
        return scope.assert.collect();
    }),
    test('rejects malformed benchmark profiles and unsupported policy fields', async function (scope: TestScope) {
        const invalidProfiles: readonly unknown[] = [
            { testFamily: 'benchmark' },
            { testFamily: 'benchmark', files: { include: [] } },
            { testFamily: 'benchmark', files: { include: [ '!source/*.ts' ] } },
            { testFamily: 'benchmark', files: { include: [ '../outside.ts' ] } },
            { testFamily: 'benchmark', files: { sets: {} } },
            { testFamily: 'benchmark', files: { include: [ 'source/*.ts' ], sets: { cold: benchmarkFiles } } },
            { testFamily: 'benchmark', files: benchmarkFiles, coverage: {} },
            { testFamily: 'benchmark', files: benchmarkFiles, execution: { processModel: 'in-process' } },
            {
                testFamily: 'benchmark',
                files: benchmarkFiles,
                execution: { processModel: 'worker-pool', scheduling: 'concurrent' }
            },
            {
                testFamily: 'benchmark',
                files: benchmarkFiles,
                execution: { processModel: 'worker-pool', maxConcurrency: 2 }
            },
            {
                testFamily: 'benchmark',
                files: benchmarkFiles,
                execution: { processModel: 'worker-pool', hedging: { mode: 'tail' } }
            },
            { testFamily: 'benchmark', files: benchmarkFiles, timeouts: { hardMilliseconds: 60_001 } },
            {
                testFamily: 'benchmark',
                files: benchmarkFiles,
                timeouts: { hardMilliseconds: 100, softMilliseconds: 101 }
            },
            { testFamily: 'benchmark', files: benchmarkFiles, reporters: [] }
        ];
        for (const profile of invalidProfiles) {
            const load = createSingleConfigModuleLoader('overkill.config.ts', {
                config: { profiles: { startup: profile } }
            });
            await scope.assert.rejects(async function () {
                await load({ configPath: null, cwd: configFixtureCwd });
            }, { type: ConfigError });
        }
        return scope.assert.collect();
    }),
    test('rejects the separate benchmark namespace and invalid profile names', async function (scope: TestScope) {
        for (
            const config of [
                { benchmark: { profiles: { startup: { files: benchmarkFiles } } } },
                { profiles: { 'cold/startup': { testFamily: 'benchmark', files: benchmarkFiles } } }
            ]
        ) {
            const load = createSingleConfigModuleLoader('overkill.config.ts', { config });
            await scope.assert.rejects(async function () {
                await load({ configPath: null, cwd: configFixtureCwd });
            }, { type: ConfigError });
        }
        return scope.assert.collect();
    }),
    test('validates in-memory policy and preserves file-origin requirements', function (scope: TestScope) {
        scope.assert.throws(function () {
            normalizeConfig({ profiles: { unit: { testFamily: 'microtest', timeouts: { hardMilliseconds: 0 } } } });
        }, { type: ConfigError, message: /positive safe integer/ });
        scope.assert.throws(function () {
            normalizeConfig({ profiles: { unit: { testFamily: 'microtest', coverage: { outputDir: 'coverage' } } } });
        }, { type: ConfigError, message: 'Coverage outputDir requires a loaded config file.' });
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
