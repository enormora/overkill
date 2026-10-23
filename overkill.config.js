import { defineConfig } from '@overkill-dev/run/config';

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
