import { type TestScope, suite, test } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import type { ReplayRunRecord } from '../../run/replay-record-types.ts';

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
type ScopedReplayOutputEvidence = {
    readonly ordinaryReplay: { readonly code: number; readonly output: string; };
    readonly debugReplay: { readonly code: number; readonly output: string; };
};

const scopedReplayOutput = defineCompositeAssertion({
    name: 'scoped replay output',
    assert(
        check,
        { ordinaryReplay, debugReplay }: ScopedReplayOutputEvidence
    ) {
        return check.group([
            check.deepEqual([ ordinaryReplay.code, debugReplay.code ], [ 0, 0 ]),
            check.equal(ordinaryReplay.output.includes('[debug:'), false),
            check.equal(debugReplay.output.includes('[debug:'), true)
        ]);
    }
});

type RecordedDebugRun = { readonly project: ReplayProject; readonly record: ReplayRunRecord; };
async function recordedDebugRun(cleanup: TestScope['cleanup']): Promise<RecordedDebugRun> {
    const project = await replayProject(cleanup, replayProfile('in-process'));
    await writeReplayCase(project, replayPassingCase('retained case', true));
    const initial = await executeReplayCli(project, [ 'run', '--profile', 'cases', '--debug' ]);
    if (initial.code !== 0) {
        throw new Error(initial.output);
    }
    const [ record ] = await replayRecords(project);
    if (record === undefined) {
        throw new Error('Expected a recorded debug run.');
    }
    return { project, record };
}
export const testNode = suite('debug replay activation', [
    test('replay clears inherited debug and accepts fresh scoped capture', async function (scope) {
        const { project, record } = await recordedDebugRun(scope.cleanup);
        scope.assert.equal(record.request.debug.mode, 'all');
        const source = { project, runId: record.id };

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
        scope.assert(scopedReplayOutput, { ordinaryReplay, debugReplay });
        await scope.assert(assertReplayRequests, source);
        return scope.assert.collect();
    })
]);
