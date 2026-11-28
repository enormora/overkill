import { availableParallelism } from 'node:os';
import { defineConfig } from './source/packages/test/config.entry-point.ts';
import { createBenchmarkHtmlReporter, createLineReporter } from './source/packages/test/reporters.entry-point.ts';
import { family as typeTestFamily } from './source/packages/type-test/type-test.entry-point.ts';

const concurrency = availableParallelism();

const integrationPolicy = {
    testFamily: 'integration' as const,
    execution: {
        processModel: 'worker-pool' as const,
        scheduling: 'concurrent' as const,
        maxConcurrency: 1,
        maxWorkers: concurrency,
        workDistribution: { mode: 'file' as const },
        workerLifecycle: 'reuse' as const,
        dispatchPolicy: 'dynamic-lease' as const
    },
    timeouts: {
        collectionMilliseconds: 120_000,
        softMilliseconds: 120_000,
        hardMilliseconds: 125_000
    }
};

const mutationCampaignPolicy = {
    ...integrationPolicy,
    execution: { ...integrationPolicy.execution, workDistribution: { mode: 'case' as const } },
    timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 360_000, hardMilliseconds: 365_000 }
};

export const config = defineConfig({
    runtimeStateDir: 'target/overkill',
    profiles: {
        types: {
            testFamily: typeTestFamily,
            execution: { processModel: 'supervised-process', scheduling: 'concurrent', maxConcurrency: concurrency },
            timeouts: { collectionMilliseconds: 240_000, softMilliseconds: 480_000, hardMilliseconds: 730_000 },
            files: { include: [ 'source/**/*.type-test.ts' ] },
            settings: {
                projectConfigPath: './source/tsconfig.type-tests.json',
                compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' }
            }
        },
        'mutation-cost': {
            testFamily: 'benchmark',
            files: {
                include: [
                    'source/integration-tests/runtime/fixtures/mutation-evidence/mutation-cost.bench.test.ts'
                ]
            },
            timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 55_000, hardMilliseconds: 60_000 },
            reporters: [
                createLineReporter(),
                createBenchmarkHtmlReporter({ outputFile: 'target/mutation-cost/report.html' })
            ]
        },
        microtests: {
            testFamily: 'microtest',
            execution: { processModel: 'supervised-process', scheduling: 'concurrent', maxConcurrency: concurrency },
            timeouts: { ...integrationPolicy.timeouts, collectionMilliseconds: 120_000 },
            files: {
                include: [ 'source/**/*.test.ts' ],
                exclude: [ 'source/integration-tests/**' ]
            },
            coverage: {
                sources: {
                    mode: 'all',
                    include: [ 'source/**/*.ts' ],
                    exclude: [
                        'source/**/*.test.ts',
                        'source/**/*.entry-point.ts',
                        'source/**/*.type-test.ts',
                        'source/test-support/**',
                        'source/integration-tests/**',
                        'source/eslint-plugin/**'
                    ]
                },
                outputs: [ 'lcov', 'text' ],
                outputDir: 'target/coverage',
                thresholds: { lines: 84, functions: 85, branches: 81 }
            }
        },
        runtime: {
            ...integrationPolicy,
            files: {
                include: [ 'source/integration-tests/runtime/**/*.test.ts' ],
                exclude: [ 'source/integration-tests/runtime/fixtures/**' ]
            }
        },
        'mutation-campaigns': {
            ...mutationCampaignPolicy,
            files: {
                include: [
                    'source/integration-tests/mutation-campaigns/runner-mutation-accuracy.test.ts',
                    'source/integration-tests/mutation-campaigns/runner-stryker-lifecycle.test.ts'
                ]
            }
        },
        'mutation-campaigns-extended': {
            ...mutationCampaignPolicy,
            files: {
                include: [
                    'source/integration-tests/mutation-campaigns/runner-mutation-accuracy-matrix.test.ts',
                    'source/integration-tests/mutation-campaigns/runner-mutation-cost.test.ts'
                ]
            }
        },
        cli: {
            ...integrationPolicy,
            files: { include: [ 'source/integration-tests/cli/**/*.test.ts' ] }
        },
        'package-smoke': {
            ...integrationPolicy,
            execution: {
                ...integrationPolicy.execution,
                workDistribution: {
                    mode: 'group',
                    unmatched: 'reject',
                    groups: [ {
                        name: 'engine-singleton',
                        fileSets: [ 'engine' ],
                        granularity: 'case',
                        workerLifecycle: 'fresh-worker-per-unit'
                    }, { name: 'package-consumers', fileSets: [ 'consumers' ], granularity: 'case' } ]
                }
            },
            files: {
                sets: {
                    engine: { include: [ 'source/integration-tests/package-smoke/engine-*.test.ts' ] },
                    consumers: {
                        include: [ 'source/integration-tests/package-smoke/**/*.test.ts' ],
                        exclude: [ 'source/integration-tests/package-smoke/engine-*.test.ts' ]
                    }
                }
            }
        }
    }
});
