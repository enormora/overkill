import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import {
    replayProject,
    writeReplayCase,
    replayAuthoringUrl,
    replayResourcesUrl
} from '../../test-support/replay-project-fixture.ts';

const wrappersEntryPoint = new URL('../../packages/test/resources.entry-point.ts', import.meta.url);
const wrappersUrl = wrappersEntryPoint.href;
function simulationSource(shared: boolean): string {
    return `import {writeFile} from 'node:fs/promises';
import {test} from ${JSON.stringify(replayAuthoringUrl)};
import {withResources} from ${JSON.stringify(wrappersUrl)};
import {defineResource,withWitnessReplay} from ${JSON.stringify(replayResourcesUrl)};
const counter=withWitnessReplay(defineResource({
    name:'counter',scope:${JSON.stringify(shared ? 'per-run' : 'per-case')},requirements:[],dependencies:{},
    acquire(){return {value:0};},
    async dispose(handle){await writeFile(new URL('./disposed.txt',import.meta.url),String(handle.value));},
    serializeHandle(handle){return {value:handle.value};},deserializeHandle(payload){return payload;}
}),({handle,witness,seed,signal})=>{
    signal.throwIfAborted();
    if(handle.value!==0 || seed!==-7n)throw new Error('Replay did not restore a fresh simulation.');
    handle.value=witness.simulation.payload.value+witness.runtimeSnapshot.counter;
});
export const testNode=test('simulation input',withResources({counter},scope=>{
    scope.assert.equal(scope.resources.counter.value,45);return scope.assert.collect();
}));`;
}
async function verifySimulationReplay(scope: TestScope, shared: boolean): Promise<void> {
    const project = await replayProject(scope, {
        testFamily: 'integration',
        files: { include: [ 'case.test.ts' ] },
        execution: shared
            ? { processModel: 'worker-pool', scheduling: 'serial', maxWorkers: 2 }
            : { processModel: 'supervised-process', scheduling: 'serial' },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
    });
    await writeReplayCase(project, simulationSource(shared));
    const witness = {
        version: 1,
        producedBy: { library: 'test-simulation', libraryVersion: '1' },
        case: { file: 'case.test.ts', suite: [], title: 'simulation input', params: null },
        kind: 'simulation',
        seed: '-7',
        simulation: { name: 'counter', payload: { value: 42 } },
        resource: { name: 'counter' },
        scenario: null,
        runtimeSnapshot: { counter: 3 },
        faultConfiguration: { fail: false }
    };
    await writeFile(path.join(project.cwd, 'simulation.json'), JSON.stringify(witness));
    const result = await orchestrator.replayWitness({
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: 'simulation.json',
        profile: 'cases'
    });
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.passed, 1);
    scope.assert.equal(await readFile(path.join(project.cwd, 'disposed.txt'), 'utf8'), '45');
}
export const testNode = suite(
    'simulation witness restoration',
    [ false, true ].map(function resourceScope(shared) {
        return test(
            shared ? 'restores projected worker resource owners' : 'restores and disposes a fresh resource',
            async function (scope) {
                await verifySimulationReplay(scope, shared);
                return scope.assert.collect();
            }
        );
    })
);
await runIfMain(import.meta, testNode);
