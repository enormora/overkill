import type { TestScope } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

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

const assertReplayRequests = defineCompositeAssertion({
    name: 'replay requests',
    async assert(check, source: DebugSourceRun) {
        const records = await replayRecords(source.project);
        return check.group([
            check.equal(records.length, 3),
            check.equal(
                records.some(function debugDisabled(record) {
                    return record.id !== source.runId && record.request.debug.mode === 'off';
                }),
                true
            ),
            check.equal(
                records.some(function scopedDebug(record) {
                    return record.request.debug.mode === 'selected';
                }),
                true
            )
        ]);
    }
});
export const testNode = suite('debug replay activation', [
    test('replay clears inherited debug and accepts fresh scoped capture', async function (scope: TestScope) {
        const debugSourceRunProject = await replayProject(scope.cleanup, replayProfile('in-process'));
        await writeReplayCase(debugSourceRunProject, replayPassingCase('retained case', true));
        const debugSourceRunOriginalRun = await executeReplayCli(debugSourceRunProject, [
            'run',
            '--profile',
            'cases',
            '--debug'
        ]);
        if (debugSourceRunOriginalRun.code !== 0) {
            throw new Error(debugSourceRunOriginalRun.output);
        }
        const [ original ] = await replayRecords(debugSourceRunProject);
        scope.require.defined(original);
        scope.assert.equal(original.request.debug.mode, 'all');
        const source = { project: debugSourceRunProject, runId: original.id };

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
        await scope.assert(assertReplayRequests, source);
        return scope.assert.collect();
    })
]);
