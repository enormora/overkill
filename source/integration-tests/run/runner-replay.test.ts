import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import type { ReplayRunRecord } from '../../run/replay-record-types.ts';
import { orchestrator, type ReplayRunCommand } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import {
    replayProject,
    replayProfile,
    writeReplayCase,
    replayPassingCase,
    replayRecords,
    executeReplayCli,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';

function replayInput(project: ReplayProject, runId: string): ReplayRunCommand {
    return {
        debug: { mode: 'off', selectors: [] },
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        runId
    };
}
async function executeOriginal(scope: TestScope, project: ReplayProject): Promise<void> {
    const result = await executeReplayCli(project, [ 'run', '--profile', 'cases', '--record' ]);
    scope.assert.equal(result.code, 0);
}
async function assertRetainedReplay(
    scope: TestScope,
    project: ReplayProject,
    file: string,
    retained: string
): Promise<void> {
    scope.assert.equal(await readFile(file, 'utf8'), retained);
    const records = await replayRecords(project);
    scope.assert.equal(records.length, 2);
}
async function verifyReplay(scope: TestScope, project: ReplayProject): Promise<void> {
    const [ original ] = await replayRecords(project);
    scope.require.defined(original);
    const file = path.join(project.cwd, '.overkill', 'runs', `${original.id}.json`);
    const retained = await readFile(file, 'utf8');
    await writeReplayCase(project, replayPassingCase('retained case', false));
    const result = await orchestrator.replay(replayInput(project, original.id));
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.deepEqual(result.runnerErrors, []);
    await assertRetainedReplay(scope, project, file, retained);
}
async function recordedEmptyProject(
    scope: TestScope
): Promise<{ readonly project: ReplayProject; readonly original: ReplayRunRecord; }> {
    const project = await replayProject(scope, replayProfile('in-process'));
    await writeReplayCase(project, replayPassingCase('empty case', true));
    await orchestrator.run(project.command);
    await orchestrator.run({ ...project.command, request: { ...project.command.request, lastFailed: true } });
    const records = await replayRecords(project);
    const original = records.find(function empty(record) {
        return record.identities.length === 0;
    });
    scope.require.defined(original);
    return { project, original };
}
async function verifyEmptyReplay(scope: TestScope): Promise<void> {
    const { project, original } = await recordedEmptyProject(scope);
    await unlink(path.join(project.cwd, 'case.test.ts'));
    const result = await orchestrator.replay(replayInput(project, original.id));
    scope.assert.equal(result.perTest.length, 0);
    scope.assert.equal(result.summary.defined, original.replayPlan.defined);
    scope.assert.deepEqual(result.runnerErrors, []);
}
async function verifyInvalidRecord(scope: TestScope): Promise<void> {
    const project = await replayProject(scope, replayProfile('in-process'));
    await writeReplayCase(project, replayPassingCase('retained case', true));
    await orchestrator.run(project.command);
    const [ original ] = await replayRecords(project);
    scope.require.defined(original);
    await writeFile(
        path.join(project.cwd, '.overkill', 'runs', `${original.id}.json`),
        JSON.stringify({ ...original, seed: '123456' })
    );
    await scope.assert.rejects(async function inconsistentSeed() {
        await orchestrator.replay(replayInput(project, original.id));
    }, { message: /seed is inconsistent/u });
}
export const testNode = suite('replay public execution boundaries', [
    ...([ 'in-process', 'supervised-process', 'worker-pool' ] as const).map(function boundary(mode) {
        return test(`${mode} reruns current bodies and preserves the source record`, async function (scope) {
            const project = await replayProject(scope, replayProfile(mode));
            await writeReplayCase(project, replayPassingCase('retained case', true));
            await executeOriginal(scope, project);
            await verifyReplay(scope, project);
            return scope.assert.collect();
        });
    }),
    test('empty replay requires no surviving source modules', async function (scope) {
        await verifyEmptyReplay(scope);
        return scope.assert.collect();
    }),
    test('replays records written before the merge intent field existed', async function (scope: TestScope) {
        const project = await replayProject(scope, replayProfile('in-process'));
        await writeReplayCase(project, replayPassingCase('retained case', true));
        await executeOriginal(scope, project);
        const [ original ] = await replayRecords(project);
        scope.require.defined(original);
        const { recordForMerge: _recordForMerge, ...request } = original.request;
        const file = path.join(project.cwd, '.overkill', 'runs', `${original.id}.json`);
        await writeFile(file, JSON.stringify({ ...original, request }));
        await verifyReplay(scope, project);
        return scope.assert.collect();
    }),
    test('rejects inconsistent records before importing code', async function (scope) {
        await verifyInvalidRecord(scope);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
