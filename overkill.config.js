import { defineConfig } from '@overkill-dev/run/config';
import {
    createBenchmarkHtmlReporter
} from './source/packages/reporter-benchmark-html/reporter-benchmark-html.entry-point.ts';
import { createLineReporter } from './source/packages/reporter-line/reporter-line.entry-point.ts';

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
        repository: {
            ...testPolicy,
            files: {
                include: [ 'source/**/*.test.ts' ],
                exclude: [ 'source/integration-tests/run/fixtures/**/*.test.ts' ]
            }
        },
        packageSmoke: {
            ...testPolicy,
            files: { include: [ 'target/build/source/integration-tests/package-smoke/**/*.test.js' ] }
        }
    }
});
