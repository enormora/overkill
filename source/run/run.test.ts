import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { resolveRun, run, type RunRequest } from './run.ts';

const runRequest: RunRequest = {
    paths: [ 'source/**/*.test.ts' ],
    selection: { kind: 'all', value: null },
    shard: { index: 0, total: 1 },
    profile: 'microtest',
    execution: { mode: 'single-worker-serial', workers: 1 },
    coverage: false,
    capture: 'buffered',
    seed: { value: 42n },
    order: 'seeded',
    debug: { mode: 'off', selectors: [] },
    configPath: null
};

registerTest('resolveRun() reports that run resolution is not implemented yet', async function () {
    await assert.rejects(resolveRun(runRequest), {
        message: 'resolveRun() is not implemented yet.'
    });
});

registerTest('run() reports that run orchestration is not implemented yet', async function () {
    await assert.rejects(run(runRequest), {
        message: 'run() is not implemented yet.'
    });
});
