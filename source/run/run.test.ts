import assert from 'node:assert/strict';
import { createFactory } from '@enormora/objectory';
import { registerTest } from '../test-support/register-test.ts';
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

registerTest('resolveRun() reports that run resolution is not implemented yet', async function () {
    await assert.rejects(resolveRun(runRequestFactory.build()), {
        message: 'resolveRun() is not implemented yet.'
    });
});

registerTest('run() reports that run orchestration is not implemented yet', async function () {
    await assert.rejects(run(runRequestFactory.build()), {
        message: 'run() is not implemented yet.'
    });
});
