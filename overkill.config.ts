import { availableParallelism } from 'node:os';
import { defineConfig } from '@overkill-dev/test/config';
import { createBenchmarkHtmlReporter, createLineReporter } from '@overkill-dev/test/reporters';

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

export const config = defineConfig({
    runtimeStateDir: 'target/overkill',
    profiles: {
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
                        'source/integration-tests/**'
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
            ...integrationPolicy,
            execution: { ...integrationPolicy.execution, workDistribution: { mode: 'case' } },
            files: { include: [ 'source/integration-tests/mutation-campaigns/**/*.test.ts' ] },
            timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 360_000, hardMilliseconds: 365_000 }
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
