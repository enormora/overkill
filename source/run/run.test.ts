import { createFactory } from '@enormora/objectory';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    resolveRun,
    run,
    type RunDebugRequest,
    type RunExecutionRequest,
    type RunRequest,
    type RunSeed,
    type RunSelection,
    type RunShard
} from './run.ts';

const runSelectionFactory = createFactory<RunSelection>(function createRunSelection() {
    return {
        kind: 'all',
        value: null
    };
});

const runShardFactory = createFactory<RunShard>(function createRunShard() {
    return {
        index: 0,
        total: 1
    };
});

const runExecutionRequestFactory = createFactory<RunExecutionRequest>(function createRunExecutionRequest() {
    return {
        mode: 'single-worker-serial',
        workers: 1
    };
});

const runSeedFactory = createFactory<RunSeed>(function createRunSeed() {
    return {
        value: 42n
    };
});

const runDebugRequestFactory = createFactory<RunDebugRequest>(function createRunDebugRequest() {
    return {
        mode: 'off',
        selectors: []
    };
});

const runRequestFactory = createFactory<RunRequest>(function createRunRequest() {
    return {
        capture: 'buffered',
        configPath: null,
        coverage: false,
        debug: runDebugRequestFactory,
        execution: runExecutionRequestFactory,
        order: 'seeded',
        paths: [ 'source/**/*.test.ts' ],
        profile: 'microtest',
        seed: runSeedFactory,
        selection: runSelectionFactory,
        shard: runShardFactory
    };
});

export const testSuite = createOverkillSuite({
    name: 'source/run/run.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'resolveRun() reports that run resolution is not implemented yet',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function rejectValue() {
                    await resolveRun(runRequestFactory.build());
                }, {
                    message: 'resolveRun() is not implemented yet.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'run() reports that run orchestration is not implemented yet',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function rejectValue() {
                    await run(runRequestFactory.build());
                }, {
                    message: 'run() is not implemented yet.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
