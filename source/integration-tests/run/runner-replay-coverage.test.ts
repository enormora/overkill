import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import type { ReplayRunRecord } from '../../run/replay-record-types.ts';
import {
    replayProject,
    writeReplayCase,
    replayAuthoringUrl,
    replayRecords,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';

type CoveredProject = { readonly project: ReplayProject; readonly source: ReplayRunRecord; };
async function coverageProject(scope: TestScope): Promise<ReplayProject> {
    const project = await replayProject(scope, {
        testFamily: 'microtest',
        files: { include: [ 'case.test.ts' ] },
        coverage: { outputs: [], sources: { mode: 'all', include: [ 'implementation.mjs' ] } },
        execution: { processModel: 'in-process', scheduling: 'serial' },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
    });
    await writeFile(path.join(project.cwd, 'implementation.mjs'), 'export function answer(){return 42;}');
    await writeReplayCase(
        project,
        `import {test} from ${JSON.stringify(replayAuthoringUrl)};
import {answer} from './implementation.mjs';
export const testNode=test('covered case',scope=>{scope.assert.equal(answer(),42);return scope.assert.collect();});`
    );
    return project;
}
async function recordedCoverageProject(scope: TestScope, empty: boolean): Promise<CoveredProject> {
    const project = await coverageProject(scope);
    const command = { ...project.command, request: { ...project.command.request, coverage: true } };
    const original = await orchestrator.run(command);
    scope.assert.equal(original.status, 'passed');
    if (empty) {
        await orchestrator.run({ ...command, request: { ...command.request, lastFailed: true } });
    }
    const records = await replayRecords(project);
    const source = records.find(function matching(record) {
        return record.identities.length === 0 === empty;
    });
    scope.require.defined(source);
    return { project, source };
}
async function assertCoverageRecords(
    scope: TestScope,
    project: ReplayProject,
    source: ReplayRunRecord,
    retained: string
): Promise<void> {
    const records = await replayRecords(project);
    const replayed = records.find(function fresh(record) {
        return record.id !== source.id && record.identities.length === source.identities.length;
    });
    scope.require.defined(replayed);
    const raw = await readdir(path.join(project.cwd, '.overkill', 'runs', replayed.id, 'coverage', 'raw'));
    scope.assert.true(raw.length > 0);
    scope.assert.equal(
        await readFile(path.join(project.cwd, '.overkill', 'runs', `${source.id}.json`), 'utf8'),
        retained
    );
}

async function verifyCoverageReplay(scope: TestScope, empty: boolean): Promise<void> {
    const { project, source } = await recordedCoverageProject(scope, empty);
    const sourceFile = path.join(project.cwd, '.overkill', 'runs', `${source.id}.json`);
    const retained = await readFile(sourceFile, 'utf8');
    if (empty) {
        await unlink(path.join(project.cwd, 'case.test.ts'));
    }
    const result = await orchestrator.replay({
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        runId: source.id
    });
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.planStatus, source.result?.planStatus);
    scope.assert.equal(result.status, empty ? 'failed' : 'passed');
    await assertCoverageRecords(scope, project, source, retained);
}

export const testNode = suite(
    'recorded coverage replay',
    [ false, true ].map(function selection(empty) {
        return test(
            empty ? 'records coverage for empty replay without source imports' : 'records fresh coverage artifacts',
            async function (scope: TestScope) {
                await verifyCoverageReplay(scope, empty);
                return scope.assert.collect();
            }
        );
    })
);
await runIfMain(import.meta, testNode);
