import { runIfMain } from '#test-runner';
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

type DebugSourceRun = { readonly project: ReplayProject; readonly runId: string; };
async function debugSourceRun(scope: TestScope): Promise<DebugSourceRun> {
    const project = await replayProject(scope, replayProfile('in-process'));
    await writeReplayCase(project, replayPassingCase('retained case', true));
    const originalRun = await executeReplayCli(project, [ 'run', '--profile', 'cases', '--debug' ]);
    if (originalRun.code !== 0) {
        throw new Error(originalRun.output);
    }
    const [ original ] = await replayRecords(project);
    scope.require.defined(original);
    scope.assert.equal(original.request.debug.mode, 'all');
    return { project, runId: original.id };
}
async function assertReplayRequests(scope: TestScope, source: DebugSourceRun): Promise<void> {
    const records = await replayRecords(source.project);
    scope.assert.equal(records.length, 3);
    scope.assert.equal(
        records.some(function debugDisabled(record) {
            return record.id !== source.runId && record.request.debug.mode === 'off';
        }),
        true
    );
    scope.assert.equal(
        records.some(function scopedDebug(record) {
            return record.request.debug.mode === 'selected';
        }),
        true
    );
}
export const testNode = suite('debug replay activation', [
    test('replay clears inherited debug and accepts fresh scoped capture', async function (scope: TestScope) {
        const source = await debugSourceRun(scope);
        const ordinaryReplay = await executeReplayCli(source.project, [ 'replay', source.runId ]);
        const debugReplay = await executeReplayCli(source.project, [
            'replay',
            source.runId,
            '--debug-scope',
            'title~retained'
        ]);
        if (debugReplay.code !== 0) {
            throw new Error(debugReplay.output);
        }
        scope.assert.deepEqual([ ordinaryReplay.code, debugReplay.code ], [ 0, 0 ]);
        scope.assert.equal(ordinaryReplay.output.includes('[debug:'), false);
        scope.assert.equal(debugReplay.output.includes('[debug:'), true);
        await assertReplayRequests(scope, source);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
