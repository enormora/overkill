import { execFile } from 'node:child_process';
import { uneval } from 'devalue';
import { createTestCase } from '@overkill-dev/engine';
import { runIfMain } from '#test-runner';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';

async function executeConsumer(script: string): Promise<string> {
    return new Promise(function executeSnapshotConsumer(resolve, reject) {
        execFile(process.execPath, [ '--input-type=module', '--eval', script ], {
            cwd: import.meta.dirname,
            timeout: 180_000
        }, function completed(error, stdout, stderr) {
            if (error === null) {
                resolve(stdout);
            } else {
                reject(new Error(stderr, { cause: error }));
            }
        });
    });
}
const script = `
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeConfig, orchestrator } from '@overkill-dev/run';
const cwd = await mkdtemp(join(process.cwd(), 'snapshot-consumer-'));
try {
    await writeFile(join(cwd, 'case.mjs'), \`
        import { test } from '@overkill-dev/test';
        import { snapshot } from '@overkill-dev/test/baselines';
        export const testNode = test('packaged snapshots', async function (scope) {
            await scope.assert(snapshot.text, 'response', 'hello');
            await scope.assert(snapshot.value, 'record', { active: true });
            await scope.assert(snapshot.bytes, 'bytes', new Uint8Array([0, 255]));
            return scope.assert.collect();
        });
    \`);
    const config = normalizeConfig({profiles: { snapshots: {
        testFamily: 'integration', files: {include: ['case.mjs']},
        execution: {processModel: 'worker-pool', maxWorkers: 1},
        baselines: {snapshots: true},
        timeouts: {collectionMilliseconds: 120000, softMilliseconds: 120000, hardMilliseconds: 180000}
    }}});
    const command = {cwd, config: {...config, reporters: []}, engine: {kind: 'default'},
        request: ${uneval(defaultRunRequest({ profile: 'snapshots' }))}};
    const updated = await orchestrator.baseline.bootstrap(command, {timing: null});
    assert.equal(updated.result.status, 'passed', JSON.stringify(updated.result));
    assert.equal(updated.changes.length, 3);
    const compared = await orchestrator.run(command, {timing: null});
    assert.equal(compared.status, 'passed', JSON.stringify(compared));
    console.log('snapshot package passed');
} finally {
    await rm(cwd, {recursive: true, force: true});
}
`;

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'compares content snapshots across packaged execution boundaries',
    async body(scope) {
        const output = await executeConsumer(script);
        scope.assert.equal(output.trim(), 'snapshot package passed');
        return scope.assert.collect();
    }
});

await runIfMain(import.meta, testNode);
