import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTestCase } from '../packages/engine/engine.entry-point.ts';

const durationCase = `
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createTestCase, defineReporter } from '@overkill-dev/engine';
import { runIfMain } from '#test-runner';
export const testNode = createTestCase({
    annotations: {}, controls: {}, definitionLocations: [{kind: 'unknown'}], title: 'elapsed time',
    async body(scope) { await wait(10); scope.assert.true(true); return scope.assert.collect(); }
});
const reporter = defineReporter(() => ({
    dispose: null, kind: 'final-result', name: 'duration', sinks: [],
    onResult(result) {
        assert.equal(result.summary.passed, 1);
        assert.ok(result.perTest[0].durationMicroseconds >= 5000);
    }
}));
await runIfMain(import.meta, testNode, { reporters: [reporter] });
`;

async function executeDurationCase(cwd: string): Promise<string> {
    return await new Promise(function launchDurationCase(resolve, reject) {
        execFile(process.execPath, [ 'duration.test.ts' ], { cwd, timeout: 10_000 }, function (error, stdout, stderr) {
            if (error === null) {
                resolve(stdout);
            } else {
                reject(new Error(`Published runner duration check failed: ${stderr}`, { cause: error }));
            }
        });
    });
}

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'published direct runner measures elapsed case duration',
    async body(scope) {
        const directory = await mkdtemp(path.join(process.cwd(), 'target', 'published-runner-'));
        scope.cleanup(async function removeDurationCase() {
            await rm(directory, { recursive: true, force: true });
        });
        await writeFile(
            path.join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                imports: { '#test-runner': '@overkill-dev/run' }
            })
        );
        await writeFile(path.join(directory, 'duration.test.ts'), durationCase);
        await writeFile(
            path.join(directory, 'overkill.config.js'),
            `export const config = {
            runtimeStateDir: 'state', profiles: { duration: {
                testFamily: 'integration', files: { include: ['duration.test.ts'] },
                execution: { processModel: 'supervised-process', scheduling: 'serial' },
                timeouts: { collectionMilliseconds: 5000, softMilliseconds: 1000, hardMilliseconds: 5000 }
            } }
        };`
        );
        scope.assert.equal(await executeDurationCase(directory), '');
        return scope.assert.collect();
    }
});

const { runIfMain } = await import('#test-runner');
await runIfMain(import.meta, testNode);
