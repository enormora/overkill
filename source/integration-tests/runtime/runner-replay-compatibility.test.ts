import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type TestScope, suite, test } from '@overkill-dev/test';
import { defineReporter } from '../../packages/engine/engine.entry-point.ts';

import { orchestrator, type ReplayRunCommand } from '../../packages/run/run.entry-point.ts';
import type { ReplayRunRecord } from '../../run/replay-record-types.ts';
import {
    replayProject,
    replayProfile,
    writeReplayCase,
    replayPassingCase,
    replayRecords,
    replayAuthoringUrl,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';

type RecordedProject = {
    readonly project: ReplayProject;
    readonly record: ReplayRunRecord;
    readonly original: Awaited<ReturnType<typeof orchestrator.run>>;
};
async function recordedProject(cleanup: TestScope['cleanup'], workers: boolean): Promise<RecordedProject> {
    const project = await replayProject(cleanup, replayProfile(workers ? 'worker-pool' : 'in-process'));
    await writeReplayCase(project, replayPassingCase('retained case', true));
    const original = await orchestrator.run(project.command);
    const [ record ] = await replayRecords(project);
    if (record === undefined) {
        throw new Error('Expected a recorded project.');
    }
    return { project, record, original };
}
function input(saved: RecordedProject): ReplayRunCommand {
    return {
        debug: { mode: 'off', selectors: [] },
        cwd: saved.project.cwd,
        config: saved.project.command.config,
        signal: null,
        runId: saved.record.id
    };
}
async function replaceRecord(saved: RecordedProject, value: unknown): Promise<void> {
    await writeFile(
        path.join(saved.project.cwd, '.overkill', 'runs', `${saved.record.id}.json`),
        JSON.stringify(value)
    );
}

export const testNode = suite('replay compatibility and cancellation', [
    test('rejects incompatible records before importing source', async (scope) => {
        const saved = await recordedProject(scope.cleanup, false);
        scope.assert.equal(saved.original.status, 'passed', { message: JSON.stringify(saved.original.runnerErrors) });
        await writeReplayCase(saved.project, "throw new Error('Imported incompatible replay.');");
        const invalid = [
            { ...saved.record, version: 2 },
            { ...saved.record, version: 99 },
            { ...saved.record, kind: 'merged' },
            { ...saved.record, replayPlan: null },
            { ...saved.record, replayProfile: {} },
            { ...saved.record, engine: { kind: 'instance' } },
            { ...saved.record, identities: [ ...saved.record.identities, ...saved.record.identities ] }
        ];
        for (const value of invalid) {
            await replaceRecord(saved, value);
            await scope.assert.rejects(async function rejectBeforeImport() {
                await orchestrator.replay(input(saved));
            }, {
                message: /incompatible|inconsistent/u
            });
        }

        return scope.assert.collect();
    }),
    test('reports interrupted and cross-major replay diagnostics', async (scope) => {
        const saved = await recordedProject(scope.cleanup, false);
        scope.assert.equal(saved.original.status, 'passed', { message: JSON.stringify(saved.original.runnerErrors) });
        await replaceRecord(saved, {
            ...saved.record,
            status: 'interrupted',
            versions: { ...saved.record.versions, node: '0.0.0' }
        });
        const result = await orchestrator.replay(input(saved));
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.includes(result.maintenanceDiagnostics.join('\n'), 'Node major');
        scope.assert.includes(result.maintenanceDiagnostics.join('\n'), 'interrupted trace');

        return scope.assert.collect();
    }),
    test('cancels an active worker replay', async (scope) => {
        const saved = await recordedProject(scope.cleanup, true);
        scope.assert.equal(saved.original.status, 'passed', { message: JSON.stringify(saved.original.runnerErrors) });
        await writeReplayCase(
            saved.project,
            `import {test} from ${JSON.stringify(replayAuthoringUrl)};
export const testNode=test('retained case',async scope=>{
    await new Promise(resolve=>setTimeout(resolve,30000));
    scope.assert.true(true);return scope.assert.collect();
});`
        );
        const controller = new AbortController();
        const reporter = defineReporter(function cancelActiveReplay() {
            return {
                name: 'cancel-active-replay',
                kind: 'real-time',
                sinks: [],
                dispose: null,
                onFinish: null,
                onEvent(event) {
                    if (event.kind === 'test-start') {
                        controller.abort();
                    }
                }
            };
        });
        const command = input(saved);
        const result = await orchestrator.replay({
            ...command,
            config: { ...command.config, reporters: [ reporter ] },
            signal: controller.signal
        });
        scope.assert.true(controller.signal.aborted);
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(JSON.stringify(result.runnerErrors), 'Replay was cancelled');

        return scope.assert.collect();
    })
]);
