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
    const command = {
        cwd, engine: {kind: 'default'},
        config: normalizeConfig({profiles: {microtest: {
            testFamily: 'microtest', files: {include: ['test.mjs']},
            execution: {processModel: 'in-process', scheduling: 'serial'}
        }}}),
        request: {
            baselineUpdateMode: 'none', capabilityRestrictions: {mode: 'enabled'}, capture: 'buffered',
            coverage: false, debug: {mode: 'off', selectors: []}, execution: {mode: 'profile-default'},
            measureProcessUsage: null, order: 'plan', paths: [], profile: 'microtest',
            processBudgetOverrides: null, processUsageSamplingIntervalMilliseconds: null,
            seed: {value: 42n}, selection: {kind: 'all'}, shard: {index: 1, total: 1},
            timingCollection: 'profile-default', verbose: false, workers: null
        }
    };
    const initialized = await orchestrator.initialize(command);
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
    const controller = new AbortController();
    controller.abort();
    const cancelled = await orchestrator.run({
        ...command,
        config: normalizeConfig({profiles: {microtest: {
            testFamily: 'microtest', files: {include: ['test.mjs']},
            execution: {processModel: 'supervised-process', scheduling: 'serial'}
        }}})
    }, {timing: null, signal: controller.signal});
    assert.equal(cancelled.status, 'failed');
    assert.equal(cancelled.runnerErrors[0].subtype, 'crash');
    assert.equal(cancelled.runnerErrors[0].attributedTo, null);
    assert.match(cancelled.runnerErrors[0].message, /cancelled/);
    assert.equal(globalThis.importCount, 1);
    await writeFile(join(cwd, 'nested.test.mjs'),
        'import {createRoot,createTestCase,createTestPlan,execute} from '+JSON.stringify(engine)+';'+
        'const metadata={annotations:{},controls:{},definitionLocations:[{kind:"unknown"}]};'+
        'export const testNode=createTestCase({...metadata,title:"outer case",async body(scope){'+
        'const inner=createTestCase({...metadata,title:"inner rejection",async body(innerScope){'+
        'Promise.reject(new Error("nested rejection"));await new Promise(resolve=>setImmediate(resolve));'+
        'innerScope.assert.true(true);return innerScope.assert.collect();}});'+
        'const result=await execute(createTestPlan(createRoot({...metadata,title:"inner",children:[inner]})));'+
        'scope.assert.equal(result.status,"failed");'+
        'scope.assert.equal(result.runnerErrors.length,1);'+
        'scope.assert.equal(result.runnerErrors[0].attributedTo.title,"inner rejection");'+
        'return scope.assert.collect();}});');
    for (const processModel of ['in-process','supervised-process']) {
        const nested = await orchestrator.run({
            ...command,
            config: normalizeConfig({profiles: {microtest: {
                testFamily: 'microtest', files: {include: ['nested.test.mjs']},
                execution: {processModel, scheduling: 'serial'}
            }}})
        });
        assert.equal(nested.status, 'passed', JSON.stringify(nested));
        assert.deepEqual(nested.runnerErrors, []);
        assert.equal(nested.summary.passed, 1);
    }
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
