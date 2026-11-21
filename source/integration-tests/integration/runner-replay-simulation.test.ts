import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { orchestrator, type RunnerResult } from '../../packages/run/run.entry-point.ts';
import {
    executeReplayCli,
    replayProject,
    writeReplayCase,
    replayAuthoringUrl,
    replayResourcesUrl,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';

const wrappersEntryPoint = new URL('../../packages/test/resources.entry-point.ts', import.meta.url);
const wrappersUrl = wrappersEntryPoint.href;
type RestoreOutcome = 'cancel' | 'fail' | 'pass';

function simulationSource(shared: boolean, outcome: RestoreOutcome): string {
    return `import {appendFile} from 'node:fs/promises';
import {test} from ${JSON.stringify(replayAuthoringUrl)};
import {withResources} from ${JSON.stringify(wrappersUrl)};
import {defineResource,withWitnessReplay} from ${JSON.stringify(replayResourcesUrl)};
const counter=withWitnessReplay(defineResource({
    name:'counter',scope:${JSON.stringify(shared ? 'per-run' : 'per-case')},requirements:[],dependencies:{},
    scenarios:{counter:{timing:'acquire',values:['default','outage'],default:'default'}},
    acquire({scenarios}) {
        if(scenarios.counter!=='outage')throw new Error('Wrong acquisition scenario');
        return {value:0};
    },
    async dispose(handle,{scenarios}) {
        await appendFile(new URL('./disposed.txt',import.meta.url),String(handle.value)+':'+scenarios.counter+'\\n');
        if(${outcome === 'fail'})throw new Error('disposal marker');
    },
    serializeHandle(handle) {
        if(handle.value!==45)throw new Error('Serialized before restore');
        return {value:handle.value};
    },
    deserializeHandle(payload){return payload;}
}),async ({handle,witness,seed,signal})=>{
    signal.throwIfAborted();
    if(handle.value!==0 || seed!==${shared ? 'null' : '-900719925474099312345n'}) {
        throw new Error('Replay did not restore a fresh simulation.');
    }
    await new Promise(resolve=>setImmediate(resolve));
    if(${outcome === 'fail'})throw new Error('restore marker');
    if(${outcome === 'cancel'})throw new DOMException('restore cancelled marker','AbortError');
    handle.value=witness.simulation.payload.value+witness.runtimeSnapshot.counter;
});
const consumer=defineResource({
    name:'consumer',scope:${JSON.stringify(shared ? 'per-run' : 'per-case')},requirements:[],dependencies:{counter},
    acquire({dependencies}) {
        if(dependencies.counter.value!==45)throw new Error('Dependency used before restore');
        return dependencies.counter.value;
    },
    serializeHandle(handle){return handle;},deserializeHandle(payload){return payload;},
    dispose:null
});
export const testNode=test('simulation input',withResources({counter,consumer},async scope=>{
    await appendFile(new URL('./disposed.txt',import.meta.url),'body\\n');
    scope.assert.equal(scope.resources.counter.value,45);
    scope.assert.equal(scope.resources.consumer,45);
    return scope.assert.collect();
}));`;
}
async function integrationProject(scope: TestScope, shared: boolean): Promise<ReplayProject> {
    return await replayProject(scope, {
        testFamily: 'integration',
        files: { include: [ 'case.test.ts' ] },
        execution: shared
            ? { processModel: 'worker-pool', scheduling: 'serial', maxWorkers: 2 }
            : { processModel: 'supervised-process', scheduling: 'serial' },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
    });
}
async function replaySimulation(project: ReplayProject, witnessPath: string): Promise<RunnerResult> {
    return await orchestrator.replayWitness({
        debug: { mode: 'off', selectors: [] },
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: witnessPath,
        profile: 'cases'
    });
}

function assertRestoreFailure(
    scope: TestScope,
    result: RunnerResult,
    outcome: Exclude<RestoreOutcome, 'pass'>
): void {
    const diagnostics = result
        .runnerErrors
        .map(function message(error) {
            return error.message;
        })
        .join('\n');
    scope.assert.match(diagnostics, outcome === 'fail' ? /restore marker/u : /restore cancelled marker/u);
    if (outcome === 'fail') {
        scope.assert.match(diagnostics, /disposal marker/u);
    }
    scope.assert.false(diagnostics.includes('Dependency used before restore'));
    scope.assert.false(diagnostics.includes('Serialized before restore'));
    scope.assert.equal(result.summary.passed, 0);
}

function assertSimulationOutcome(
    scope: TestScope,
    result: RunnerResult,
    disposed: string,
    outcome: RestoreOutcome
): void {
    if (outcome === 'pass') {
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(disposed, 'body\n45:outage\n');
        return;
    }
    assertRestoreFailure(scope, result, outcome);
    scope.assert.equal(disposed, '0:outage\n');
}

async function verifySimulationReplay(scope: TestScope, shared: boolean, outcome: RestoreOutcome): Promise<void> {
    const project = await integrationProject(scope, shared);
    await writeReplayCase(project, simulationSource(shared, outcome));
    const witness = {
        version: 1,
        producedBy: { library: 'test-simulation', libraryVersion: '1' },
        case: { file: 'case.test.ts', suite: [], title: 'simulation input', params: null },
        kind: 'simulation',
        seed: shared ? null : '-900719925474099312345',
        simulation: { name: 'counter', payload: { value: 42 } },
        resource: shared ? null : { name: 'counter' },
        scenario: 'outage',
        runtimeSnapshot: { counter: 3 },
        faultConfiguration: { fail: false }
    };
    await writeFile(path.join(project.cwd, 'simulation.json'), JSON.stringify(witness));
    const result = await replaySimulation(project, 'simulation.json');
    const disposed = await readFile(path.join(project.cwd, 'disposed.txt'), 'utf8');
    assertSimulationOutcome(scope, result, disposed, outcome);
}

const simulationEntryPoint = new URL('../../packages/simulation/simulation.entry-point.ts', import.meta.url);
const simulationUrl = simulationEntryPoint.href;
function httpSource(current: boolean): string {
    const responseVersion = JSON.stringify(current ? 'current' : 'historical');
    return `import {test} from ${JSON.stringify(replayAuthoringUrl)};
import {defineRuntime,createSimulatedHttpServerResource,withRuntime} from ${JSON.stringify(wrappersUrl)};
import {defineSimulatedHttpServer} from ${JSON.stringify(simulationUrl)};
const api=createSimulatedHttpServerResource({
    address:{kind:'loopback',port:0},
    simulation:defineSimulatedHttpServer({
        name:'api',scenarios:{default:{title:'Default'},outage:{title:'Outage'}},
        handle(request,scenario){return Response.json(${responseVersion}+':'+scenario.key);}
    })
});
const runtime=defineRuntime({name:'http',dimensions:{},requirements:[],resources:{api}})
    .scenario({api:${JSON.stringify(current ? 'default' : 'outage')}});
export const testNode=test('HTTP scenario',withRuntime(runtime,async scope=>{
    const response=await fetch(scope.runtimes.http.api.baseUrl);
    scope.assert.equal(await response.json(),'current:outage');
    return scope.assert.collect();
}));`;
}

async function saveHttpWitness(scope: TestScope, project: ReplayProject): Promise<string> {
    await writeReplayCase(project, httpSource(false));
    const historical = await orchestrator.run(project.command);
    scope.assert.deepEqual(historical.runnerErrors, []);
    scope.assert.equal(historical.summary.failed, 1);
    const payload = historical
        .artifacts
        .find(function (artifact) {
            return artifact.id.subtype === 'witness';
        })
        ?.payload;
    if (payload?.kind !== 'runtime-attachment' || payload.content.kind !== 'file') {
        throw new Error('Expected a retained HTTP witness.');
    }
    return payload.content.path;
}

async function verifyHttpReplay(scope: TestScope): Promise<void> {
    const project = await integrationProject(scope, false);
    const witnessPath = await saveHttpWitness(scope, project);
    await writeReplayCase(project, httpSource(true));
    const result = await replaySimulation(project, witnessPath);
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.passed, 1);
    const cli = await executeReplayCli(project, [ 'replay-witness', witnessPath, '--profile', 'cases' ]);
    scope.assert.equal(cli.code, 0);
}
const restoreCases = [
    { shared: false, outcome: 'pass' },
    { shared: false, outcome: 'fail' },
    { shared: false, outcome: 'cancel' },
    { shared: true, outcome: 'pass' },
    { shared: true, outcome: 'fail' },
    { shared: true, outcome: 'cancel' }
] as const;

export const testNode: TestNode = suite('simulation witness restoration', [
    table({
        title: 'reproduces saved simulation outcomes',
        cases: restoreCases,
        caseTitle({ shared, outcome }) {
            return `${shared ? 'worker-owned' : 'per-case'} restore can ${outcome}`;
        },
        async test(scope) {
            const { shared, outcome } = scope.parameters;
            await verifySimulationReplay(scope, shared, outcome);
            return scope.assert.collect();
        }
    }),
    test('replays the saved HTTP scenario with the current handler', async function (scope) {
        await verifyHttpReplay(scope);
        return scope.assert.collect();
    })
]);
