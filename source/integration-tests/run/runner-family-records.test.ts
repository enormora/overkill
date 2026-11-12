import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import {
    replayProject,
    writeReplayCase,
    replayPassingCase,
    replayRecords,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';
import { family } from './fixtures/imported-runtime-family.ts';

const policy = {
    settings: null,
    files: { include: [ 'case.test.ts' ] as const },
    execution: { processModel: 'supervised-process', scheduling: 'serial' } as const,
    timeouts: { collectionMilliseconds: 60_000, softMilliseconds: 60_000, hardMilliseconds: 60_000 }
};

async function configuredFamilyProject(scope: TestScope): Promise<ReplayProject> {
    const project = await replayProject(scope, { ...policy, testFamily: family });
    const familyUrl = import.meta.resolve('./fixtures/imported-runtime-family.ts');
    await writeFile(
        path.join(project.cwd, 'overkill.config.ts'),
        `import {family} from ${JSON.stringify(familyUrl)}; export const config = {profiles:{cases:{...${
            JSON.stringify(policy)
        },testFamily:family}}};`
    );
    await writeReplayCase(project, replayPassingCase('family case', true));
    return project;
}

async function assertFamilyReplay(scope: TestScope, project: ReplayProject): Promise<void> {
    const [ record ] = await replayRecords(project);
    scope.require.defined(record);
    scope.assert.equal(record.version, 3);
    scope.assert.equal(record.facts.family?.id, family.id);
    scope.assert.equal(record.facts.family?.version, '1');
    scope.assert.equal(JSON.stringify(record.facts.family?.collection), '{"selected":2}');
    const replay = await orchestrator.replay({
        cwd: project.cwd,
        config: project.command.config,
        runId: record.id,
        debug: { mode: 'off', selectors: [] },
        signal: null
    });
    scope.assert.equal(replay.status, 'passed');
    scope.assert.equal(replay.summary.passed, 2);
    scope.assert.deepEqual(replay.runnerErrors, []);
}

export const testNode = suite('imported family records', [
    test(
        'records and reproduces frozen family variants through explicit configuration',
        async function (scope: TestScope) {
            const project = await configuredFamilyProject(scope);
            const configPath = path.join(project.cwd, 'overkill.config.ts');
            const original = await orchestrator.run({
                kind: 'configured',
                command: project.command,
                source: { kind: 'config-file', request: { cwd: project.cwd, configPath }, resolvedPath: configPath }
            });
            scope.assert.deepEqual(original.runnerErrors, []);
            scope.assert.equal(original.status, 'passed');
            if (original.status === 'passed') {
                await assertFamilyReplay(scope, project);
            }
            return scope.assert.collect();
        }
    )
]);

await runIfMain(import.meta, testNode);
