import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite } from '@overkill-dev/test';

import { orchestrator } from '../../packages/run/run.entry-point.ts';
import {
    replayProject,
    writeReplayCase,
    replayPassingCase,
    replayRecords,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';
import { family } from './fixtures/imported-runtime-family.ts';

const assertPreparation = defineCompositeAssertion({
    name: 'preparation',
    async assert(check, project: ReplayProject) {
        const [ record ] = await replayRecords(project);
        if (record === undefined || record === null) {
            return check.defined(record);
        }
        const initialChecks = check.group([
            check.defined(record),
            check.equal(record.facts.family?.id, family.id),
            check.equal(record.facts.family?.version, '1'),
            check.deepEqual(structuredClone<unknown>(record.facts.family?.preparation), { source: 'original' }),
            check.equal(record.facts.family?.collection, null),
            check.deepEqual(record.facts.cases, [])
        ]);
        const replay = await orchestrator.replay({
            cwd: project.cwd,
            config: project.command.config,
            runId: record.id,
            debug: { mode: 'off', selectors: [] },
            signal: null
        });
        return check.group([
            initialChecks,
            check.equal(replay.summary.planned, 0),
            check.deepEqual(replay.runnerErrors, [])
        ]);
    }
});

export const testNode = suite(
    'imported family empty selections',
    [ table({
        title: 'records preparation facts for an empty selection',
        cases: [ 'supervised-process', 'worker-pool' ] as const,
        caseTitle: String,
        async test(scope) {
            const processModel = scope.parameters;

            const project = await replayProject(scope.cleanup, {
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
            await scope.assert(assertPreparation, project);
            return scope.assert.collect();
        }
    }) ]
);
