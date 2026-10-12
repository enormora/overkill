import { execFile } from 'node:child_process';
import { createSuite, createTestCase } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';

const lifecycleScript = `
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { orchestrator, normalizeConfig, RunCollectionError } from '@overkill-dev/run';
const cwd = await realpath(await mkdtemp(join(process.cwd(), 'collected-smoke-')));
try {
    const engine = import.meta.resolve('@overkill-dev/engine');
    await writeFile(join(cwd, 'test.mjs'), \`
        import { createTestCase } from \${JSON.stringify(engine)};
        if (!globalThis.bootstrapReady) throw new Error('import before bootstrap');
        globalThis.importCount = (globalThis.importCount ?? 0) + 1;
        globalThis.scopes = [];
        export const testNode = createTestCase({
            annotations: {}, controls: {}, definitionLocations: [{kind: 'unknown'}], title: 'passes',
            body(scope) {
                globalThis.scopes.push(scope);
                scope.assert.equal(1, 1);
                return scope.assert.collect();
            }
        });
    \`);
    const initialized = await orchestrator.initialize({
        cwd, engine: {kind: 'default'},
        config: normalizeConfig({profiles: {microtest: {
            testFamily: 'microtest', files: {include: ['test.mjs']},
            execution: {processModel: 'in-process', scheduling: 'serial'}
        }}}),
        request: {
            baselineUpdateMode: 'none', capabilityRestrictions: {mode: 'enabled'}, capture: 'buffered',
            coverage: false, debug: {mode: 'off', selectors: []}, execution: {mode: 'profile-default'},
            measureResourceUsage: null, order: 'plan', paths: [], profile: 'microtest',
            resourceBudgetOverrides: null, resourceUsageSamplingIntervalMilliseconds: null,
            seed: {value: 42n}, selection: {kind: 'all'}, shard: {index: 1, total: 1},
            timingCollection: 'profile-default', verbose: false, workers: null
        }
    });
    assert.equal(globalThis.importCount, undefined);
    globalThis.bootstrapReady = true;
    const collected = await initialized.collect();
    assert.equal(await initialized.collect(), collected);
    const first = await collected.run({selection: {kind: 'all'}});
    const second = await collected.runWithReporterDelivery({selection: {kind: 'all'}});
    assert.deepEqual([first.status, second.result.status], ['passed', 'passed']);
    assert.equal(globalThis.importCount, 1);
    assert.equal(globalThis.scopes.length, 2);
    assert.notEqual(globalThis.scopes[0], globalThis.scopes[1]);
    assert.deepEqual(second.undeliveredRunnerErrors, []);
    assert.equal(typeof RunCollectionError, 'function');
    process.stdout.write('packaged collected lifecycle passed\\n');
} finally {
    await rm(cwd, {recursive: true, force: true});
}
`;

async function executeLifecycleScript(): Promise<string> {
    return new Promise(function launchConsumer(resolve, reject) {
        execFile(process.execPath, [ '--input-type=module', '--eval', lifecycleScript ], {
            cwd: import.meta.dirname,
            timeout: 10_000
        }, function collectOutput(error, stdout) {
            if (error instanceof Error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'packaged public runner lifecycle',
    children: [ createTestCase({
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        title: 'consumer bootstraps before imports and reruns the public collected handle',
        async body(scope) {
            scope.assert.equal(await executeLifecycleScript(), 'packaged collected lifecycle passed\n');
            return scope.assert.collect();
        }
    }) ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
