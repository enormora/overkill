import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { ConfigError, normalizeConfig, type NormalizedConfig } from '../packages/run/config.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { createDirectRunFixture } from '../test-support/direct-run-fixture.ts';
import { copyConfig } from '../config/snapshot.ts';
import { RunResolutionError } from './run-errors.ts';
import { createCommandLineErrorResultFromUnknown } from './command-line-command.ts';
import { createCommandLineRunner } from './command-line-runner.ts';

const benchmarkFile = 'source/startup.bench.ts';
const benchmark = { testFamily: 'benchmark', files: { include: [ benchmarkFile ] } } as const;

async function rejectUnexpectedInvocation(): Promise<never> {
    throw new Error('Benchmark profiles must be rejected before collection or reporter loading.');
}

export const testNode = suite('benchmark profile command boundaries', [
    test('snapshots mixed profiles without losing retry, work-group or coverage policies', function (scope: TestScope) {
        const config = normalizeConfig({
            profiles: {
                startup: benchmark,
                service: {
                    testFamily: 'integration',
                    files: { sets: { smoke: { include: [ 'source/smoke.test.ts' ] } } },
                    retries: { maxAttempts: 2, artifacts: 'first-failure-and-final' },
                    execution: {
                        processModel: 'worker-pool',
                        workDistribution: {
                            mode: 'group',
                            groups: [ { name: 'service', fileSets: [ 'smoke' ] } ]
                        }
                    }
                },
                unit: {
                    testFamily: 'microtest',
                    coverage: { sources: { mode: 'all', include: [ 'source/**/*.ts' ], exclude: [] } }
                }
            }
        });
        const snapshot = copyConfig(config);
        scope.assert.deepEqual(snapshot, config);
        scope.assert.notEqual(snapshot.profiles, config.profiles);
        scope.assert.notEqual(snapshot.profiles.service, config.profiles.service);
        scope.assert.notEqual(snapshot.profiles.unit, config.profiles.unit);
        return scope.assert.collect();
    }),
    ...([ 'run', 'list' ] as const).map(function (command) {
        return test(
            `ordinary ${command} rejects benchmark profiles before collection and reporter loading`,
            async function (scope: TestScope) {
                const config = normalizeConfig({ profiles: { startup: benchmark } });
                const runner = createCommandLineRunner({
                    createDefaultReporter: rejectUnexpectedInvocation,
                    loadBaselineCommands: rejectUnexpectedInvocation,
                    loadBenchmarkCommands: rejectUnexpectedInvocation,
                    async loadConfig() {
                        return { ...config, configPath: null };
                    },
                    orchestrator: {
                        resolve: rejectUnexpectedInvocation,
                        run: rejectUnexpectedInvocation,
                        runWithReporterDelivery: rejectUnexpectedInvocation
                    }
                });
                const request = defaultRunRequest({ profile: 'startup', paths: [ 'missing.bench.ts' ] });
                const result = command === 'run'
                    ? await runner.runTests({ configPath: null, cwd: process.cwd(), runRequest: request })
                    : await runner.listTests({
                        configPath: null,
                        cwd: process.cwd(),
                        listRequest: { ...request, order: 'seeded', withLocations: false, withOrphans: false }
                    });
                scope.assert.equal(result.exitCode, 3);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill argument error: Profile "startup" has testFamily "benchmark". Use "overkill bench run" or "overkill bench list".'
                ]);
                return scope.assert.collect();
            }
        );
    }),
    test(
        'resolves a microtest named benchmark while preserving unrelated benchmark profiles',
        async function (scope: TestScope) {
            const config = normalizeConfig({
                profiles: {
                    benchmark: { testFamily: 'microtest', execution: { processModel: 'in-process' } },
                    startup: benchmark
                }
            });
            const snapshot = copyConfig(config);
            const resolved = await createDeterministicRunOrchestrator().resolve({
                config,
                cwd: process.cwd(),
                engine: { kind: 'default' },
                request: defaultRunRequest({
                    profile: 'benchmark',
                    paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ]
                })
            });
            scope.assert.equal(resolved.facts.execution.testFamily, 'microtest');
            scope.require.defined(resolved.config.profiles.startup);
            scope.require.defined(config.profiles.startup);
            scope.assert.deepEqual(resolved.config.profiles.startup, config.profiles.startup);
            scope.assert.deepEqual(config, snapshot);
            scope.assert.deepEqual(
                { config: Object.isFrozen(config), profile: Object.isFrozen(config.profiles.startup) },
                { config: false, profile: false }
            );
            return scope.assert.collect();
        }
    ),
    test(
        'rejects ordinary benchmark execution before discovering its missing files',
        async function (scope: TestScope) {
            const config = normalizeConfig({ profiles: { startup: benchmark } });
            await scope.assert.rejects(async function () {
                await createDeterministicRunOrchestrator().resolve({
                    config,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest({ profile: 'startup', paths: [ 'missing.bench.ts' ] })
                });
            }, {
                type: RunResolutionError,
                message:
                    'Profile "startup" has testFamily "benchmark". Use "overkill bench run" or "overkill bench list".'
            });
            return scope.assert.collect();
        }
    ),
    test(
        'rejects malformed unselected benchmark policy before ordinary file discovery',
        async function (scope: TestScope) {
            const normalized = normalizeConfig({ profiles: { startup: benchmark } });
            const config = {
                ...normalized,
                profiles: {
                    ...normalized.profiles,
                    startup: {
                        testFamily: 'benchmark',
                        files: { include: [ benchmarkFile ], exclude: [] },
                        execution: { processModel: 'in-process' }
                    }
                }
            } as unknown as NormalizedConfig;
            await scope.assert.rejects(async function () {
                await createDeterministicRunOrchestrator().resolve({
                    config,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRunRequest({ paths: [ 'missing.test.ts' ] })
                });
            }, { type: ConfigError, message: /Invalid benchmark profile "startup"/ });
            return scope.assert.collect();
        }
    ),
    test('maps benchmark family guidance to argument exit code three', function (scope: TestScope) {
        const error = new RunResolutionError('Use "overkill bench run".', undefined, 'unsupported-request');
        const result = createCommandLineErrorResultFromUnknown(error);
        scope.assert.equal(result.exitCode, 3);
        scope.assert.deepEqual(result.fallbackDiagnostics, [ 'Overkill argument error: Use "overkill bench run".' ]);
        return scope.assert.collect();
    }),
    test(
        'rejects a sole direct benchmark match instead of falling back to microtest',
        async function (scope: TestScope) {
            const fixture = createDirectRunFixture({
                config: { profiles: { startup: benchmark } },
                fileName: benchmarkFile,
                files: [ benchmarkFile ]
            });
            const node = test('benchmark body', function (directScope) {
                directScope.assert.fail({ message: 'Benchmark body must not execute through runIfMain.' });
                return directScope.assert.collect();
            });
            await scope.assert.rejects(async function () {
                await fixture.runIfMain(fixture.project.meta, node);
            }, { type: RunResolutionError, message: /Use "overkill bench run"/ });
            return scope.assert.collect();
        }
    ),
    test(
        'preserves ambiguity errors when ordinary and benchmark profiles match a direct file',
        async function (scope: TestScope) {
            const fixture = createDirectRunFixture({
                config: {
                    profiles: {
                        startup: benchmark,
                        unit: { testFamily: 'microtest', files: benchmark.files }
                    }
                },
                fileName: benchmarkFile,
                files: [ benchmarkFile ]
            });
            const node = test('body', function (directScope) {
                directScope.assert.fail({ message: 'An ambiguous profile must not execute.' });
                return directScope.assert.collect();
            });
            await scope.assert.rejects(async function () {
                await fixture.runIfMain(fixture.project.meta, node);
            }, { type: ConfigError, message: /matched multiple profiles/ });
            return scope.assert.collect();
        }
    )
]);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
