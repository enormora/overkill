import { defineConfig, type ProjectIntegrationProfileConfig } from '@overkill-dev/test/config';
import { createBenchmarkHtmlReporter, createLineReporter } from '@overkill-dev/test/reporters';

const integrationPolicy: Pick<ProjectIntegrationProfileConfig, 'execution' | 'testFamily' | 'timeouts'> = {
    testFamily: 'integration',
    execution: { processModel: 'supervised-process', scheduling: 'serial' },
    timeouts: {
        collectionMilliseconds: 30_000,
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
                    'source/integration-tests/integration/fixtures/mutation-evidence/mutation-cost.bench.test.ts'
                ]
            },
            timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 55_000, hardMilliseconds: 60_000 },
            reporters: [
                createLineReporter(),
                createBenchmarkHtmlReporter({ outputFile: 'target/mutation-cost/report.html' })
            ]
        },
        unit: {
            testFamily: 'microtest',
            execution: { processModel: 'supervised-process', scheduling: 'concurrent', maxConcurrency: 8 },
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
                        'target/**'
                    ]
                },
                outputs: [ 'lcov', 'text' ],
                outputDir: 'target/coverage',
                thresholds: { lines: 84, functions: 85, branches: 81 }
            }
        },
        integration: {
            ...integrationPolicy,
            files: {
                include: [ 'source/integration-tests/integration/**/*.test.ts' ],
                exclude: [ 'source/integration-tests/integration/fixtures/**' ]
            }
        },
        'mutation-campaigns': {
            ...integrationPolicy,
            files: { include: [ 'source/integration-tests/mutation-campaigns/**/*.test.ts' ] },
            timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 360_000, hardMilliseconds: 365_000 }
        },
        process: {
            ...integrationPolicy,
            files: { include: [ 'source/integration-tests/process/**/*.test.ts' ] }
        },
        'compiler-assessment': {
            ...integrationPolicy,
            files: { include: [ 'source/integration-tests/compiler-assessment/**/*.test.ts' ] }
        },
        'package-smoke': {
            ...integrationPolicy,
            files: { include: [ 'source/integration-tests/package-smoke/**/*.test.ts' ] }
        }
    }
});
