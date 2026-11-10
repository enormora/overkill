import { watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { orchestrator, type ReplayRunCommand } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
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

type RecordedProject = { readonly project: ReplayProject; readonly record: ReplayRunRecord; };
async function recordedProject(scope: TestScope, workers: boolean): Promise<RecordedProject> {
    const project = await replayProject(scope, replayProfile(workers ? 'worker-pool' : 'in-process'));
    await writeReplayCase(project, replayPassingCase('retained case', true));
    await orchestrator.run(project.command);
    const [ record ] = await replayRecords(project);
    scope.require.defined(record);
    return { project, record };
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
async function verifyIncompatibleRecords(scope: TestScope): Promise<void> {
    const saved = await recordedProject(scope, false);
    await writeReplayCase(saved.project, "throw new Error('Imported incompatible replay.');");
    const invalid = [
        { ...saved.record, version: 1 },
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
}
async function verifyInterruptedDiagnostics(scope: TestScope): Promise<void> {
    const saved = await recordedProject(scope, false);
    await replaceRecord(saved, {
        ...saved.record,
        status: 'interrupted',
        versions: { ...saved.record.versions, node: '0.0.0' }
    });
    const result = await orchestrator.replay(input(saved));
    scope.assert.equal(result.summary.passed, 1);
    scope.assert.includes(result.maintenanceDiagnostics.join('\n'), 'Node major');
    scope.assert.includes(result.maintenanceDiagnostics.join('\n'), 'interrupted trace');
}
async function verifyActiveCancellation(scope: TestScope): Promise<void> {
    const saved = await recordedProject(scope, true);
    await writeReplayCase(
        saved.project,
        `import {writeFile} from 'node:fs/promises';
import {test} from ${JSON.stringify(replayAuthoringUrl)};
export const testNode=test('retained case',async scope=>{
    await writeFile(new URL('./started.txt',import.meta.url),'started');
    await new Promise(resolve=>setTimeout(resolve,30000));
    scope.assert.true(true);return scope.assert.collect();
});`
    );
    const controller = new AbortController();
    const started = watch(saved.project.cwd, function cancelStartedReplay(_event, name) {
        if (name === 'started.txt') {
            controller.abort();
        }
    });
    try {
        const result = await orchestrator.replay({ ...input(saved), signal: controller.signal });
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(JSON.stringify(result.runnerErrors), 'Replay was cancelled');
    } finally {
        started.close();
    }
}
export const testNode = suite('replay compatibility and cancellation', [
    test('rejects incompatible records before importing source', async function (scope: TestScope) {
        await verifyIncompatibleRecords(scope);
        return scope.assert.collect();
    }),
    test('reports interrupted and cross-major replay diagnostics', async function (scope: TestScope) {
        await verifyInterruptedDiagnostics(scope);
        return scope.assert.collect();
    }),
    test('cancels an active worker replay', async function (scope: TestScope) {
        await verifyActiveCancellation(scope);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
