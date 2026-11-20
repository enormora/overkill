import { defineConfig } from '@overkill-dev/test/config';
import { createBenchmarkHtmlReporter, createLineReporter } from '@overkill-dev/test/reporters';

const testPolicy = {
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
                    'target/build/source/integration-tests/run/fixtures/mutation-evidence/mutation-cost.bench.test.js'
                ]
            },
            timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 55_000, hardMilliseconds: 60_000 },
            reporters: [
                createLineReporter(),
                createBenchmarkHtmlReporter({ outputFile: 'target/mutation-cost/report.html' })
            ]
        },
        unit: {
            ...testPolicy,
            testFamily: 'microtest',
            execution: { processModel: 'in-process', scheduling: 'serial' },
            files: { include: [ 'source/overkill.test.ts' ] },
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
                thresholds: { lines: 90, functions: 91, branches: 88 }
            }
        },
        integration: {
            ...testPolicy,
            files: { include: [ 'source/integration-tests/repository.test.ts' ] }
        },
        mutationCampaigns: {
            ...testPolicy,
            files: { include: [ 'source/integration-tests/run/runner-mutation-accuracy.test.ts' ] },
            timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 360_000, hardMilliseconds: 365_000 }
        },
        process: {
            ...testPolicy,
            files: { include: [ 'source/integration-tests/process.test.ts' ] }
        },
        compilerAssessment: {
            ...testPolicy,
            files: { include: [ 'source/integration-tests/type-test-api/compiler-assessment.test.ts' ] }
        },
        packageSmoke: {
            ...testPolicy,
            files: {
                include: [
                    'target/build/source/integration-tests/package-smoke/content-snapshots.test.js',
                    'target/build/source/integration-tests/package-smoke/engine-direct-execution.test.js',
                    'target/build/source/integration-tests/package-smoke/run-lifecycle.test.js',
                    'target/build/source/integration-tests/package-smoke/benchmark-html.test.js',
                    'target/build/source/integration-tests/package-smoke/bench.test.js',
                    'target/build/source/integration-tests/package-smoke/property.test.js',
                    'target/build/source/integration-tests/package-smoke/model.test.js',
                    'target/build/source/integration-tests/package-smoke/differential.test.js',
                    'target/build/source/integration-tests/package-smoke/eslint-test.test.js',
                    'target/build/source/integration-tests/package-smoke/linearizability.test.js',
                    'target/build/source/integration-tests/package-smoke/type-test.test.js',
                    'target/build/source/integration-tests/package-smoke/stryker-runner.test.js',
                    'target/build/source/integration-tests/package-smoke/test-binary.test.js',
                    'target/build/source/integration-tests/package-smoke/test-binary-permissions.test.js',
                    'target/build/source/integration-tests/package-smoke/test-binary-attachments.test.js',
                    'target/build/source/integration-tests/package-smoke/test-binary-coverage.test.js'
                ]
            }
        }
    }
});
