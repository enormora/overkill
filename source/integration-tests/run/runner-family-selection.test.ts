import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import {
    replayProject,
    writeReplayCase,
    replayPassingCase,
    replayRecords,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';
import { family } from './fixtures/imported-runtime-family.ts';

async function assertPreparation(scope: TestScope, project: ReplayProject): Promise<void> {
    const [ record ] = await replayRecords(project);
    scope.require.defined(record);
    scope.assert.equal(record.facts.family?.id, family.id);
    scope.assert.equal(record.facts.family?.version, '1');
    scope.assert.deepEqual(structuredClone<unknown>(record.facts.family?.preparation), { source: 'original' });
    scope.assert.equal(record.facts.family?.collection, null);
    scope.assert.deepEqual(record.facts.cases, []);
    const replay = await orchestrator.replay({
        cwd: project.cwd,
        config: project.command.config,
        runId: record.id,
        debug: { mode: 'off', selectors: [] },
        signal: null
    });
    scope.assert.equal(replay.summary.planned, 0);
    scope.assert.deepEqual(replay.runnerErrors, []);
}

export const testNode = suite(
    'imported family empty selections',
    ([ 'supervised-process', 'worker-pool' ] as const).map(function boundary(processModel) {
        return test(
            `records preparation facts for an empty ${processModel} selection`,
            async function (scope: TestScope) {
                const project = await replayProject(scope, {
                    testFamily: family,
                    settings: null,
                    files: { include: [ 'case.test.ts' ] },
                    execution: { processModel, scheduling: 'serial' },
                    timeouts: { collectionMilliseconds: 60_000, softMilliseconds: 60_000, hardMilliseconds: 60_000 }
                });
                await writeReplayCase(project, replayPassingCase('unselected family case', true));
                const result = await orchestrator.run({
                    ...project.command,
                    request: { ...project.command.request, selection: { kind: 'none' } }
                });
                scope.assert.equal(result.summary.planned, 0);
                await assertPreparation(scope, project);
                return scope.assert.collect();
            }
        );
    })
);

await runIfMain(import.meta, testNode);
