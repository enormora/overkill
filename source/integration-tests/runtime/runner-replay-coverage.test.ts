import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, type TestScope, suite } from '@overkill-dev/test';
import type { RunnerResult } from '../../packages/run/run.entry-point.ts';

import type { ReplayRunRecord } from '../../run/replay-record-types.ts';
import {
    replayProject,
    writeReplayCase,
    replayAuthoringUrl,
    replayRecords,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';
import { coverageSubject } from './support/coverage-subject.ts';

type CoveredProject = {
    readonly project: ReplayProject;
    readonly source: ReplayRunRecord;
    readonly original: Awaited<ReturnType<typeof coverageSubject.run>>;
};
async function coverageProject(cleanup: TestScope['cleanup']): Promise<ReplayProject> {
    const project = await replayProject(cleanup, {
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
async function recordedCoverageProject(cleanup: TestScope['cleanup'], empty: boolean): Promise<CoveredProject> {
    const project = await coverageProject(cleanup);
    const command = { ...project.command, request: { ...project.command.request, coverage: true } };
    const original = await coverageSubject.run(command);
    if (empty) {
        await coverageSubject.run({ ...command, request: { ...command.request, lastFailed: true } });
    }
    const records = await replayRecords(project);
    const source = records.find(function matching(record) {
        return record.identities.length === 0 === empty;
    });
    if (source === undefined) {
        throw new Error('Expected a recorded coverage run.');
    }
    return { project, source, original };
}
const assertCoverageRecords = defineCompositeAssertion({
    name: 'coverage records',
    async assert(check, project: ReplayProject, source: ReplayRunRecord, retained: string) {
        const records = await replayRecords(project);
        const replayed = records.find(function fresh(record) {
            return record.id !== source.id && record.identities.length === source.identities.length;
        });
        if (replayed === undefined) {
            return check.defined(replayed);
        }
        const raw = await readdir(path.join(project.cwd, '.overkill', 'runs', replayed.id, 'coverage', 'raw'));
        return check.group([
            check.true(raw.length > 0),
            check.equal(
                await readFile(path.join(project.cwd, '.overkill', 'runs', `${source.id}.json`), 'utf8'),
                retained
            )
        ]);
    }
});

type ReplayedCoverageOutcomeEvidence = {
    readonly verifyCoverageReplayResult: RunnerResult;
    readonly source: ReplayRunRecord;
    readonly empty: boolean;
};

const replayedCoverageOutcome = defineCompositeAssertion({
    name: 'replayed coverage outcome',
    assert(
        check,
        { verifyCoverageReplayResult, source, empty }: ReplayedCoverageOutcomeEvidence
    ) {
        return check.group([
            check.deepEqual(verifyCoverageReplayResult.runnerErrors, []),
            check.equal(verifyCoverageReplayResult.planStatus, source.result?.planStatus),
            check.equal(verifyCoverageReplayResult.status, empty ? 'failed' : 'passed')
        ]);
    }
});

export const testNode = suite(
    'recorded coverage replay',
    [ table({
        title: 'records fresh coverage when replaying saved runs',
        cases: [ false, true ],
        caseTitle(empty) {
            return empty
                ? 'records coverage for empty replay without source imports'
                : 'records fresh coverage artifacts';
        },
        async test({ cleanup, assert, parameters: empty }) {
            const { project, source, original } = await recordedCoverageProject(cleanup, empty);
            assert.equal(original.status, 'passed');
            const verifyCoverageReplaySourceFile = path.join(project.cwd, '.overkill', 'runs', `${source.id}.json`);
            const verifyCoverageReplayRetained = await readFile(verifyCoverageReplaySourceFile, 'utf8');
            if (empty) {
                await unlink(path.join(project.cwd, 'case.test.ts'));
            }
            const verifyCoverageReplayResult = await coverageSubject.replay({
                debug: { mode: 'off', selectors: [] },
                cwd: project.cwd,
                config: project.command.config,
                signal: null,
                runId: source.id
            });
            assert(replayedCoverageOutcome, { verifyCoverageReplayResult, source, empty });
            await assert(assertCoverageRecords, project, source, verifyCoverageReplayRetained);

            return assert.collect();
        }
    }) ]
);
